"""文件上传解析服务 — 校验、存储、提取文本、LLM 解析、写入 documents。"""

import logging
import os
import uuid
from datetime import datetime

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import Document

logger = logging.getLogger(__name__)


class FileUploadError(Exception):
    """文件上传异常。"""


class FileUploadService:
    """文件上传处理服务。"""

    def __init__(self) -> None:
        self.allowed_types = set(settings.allowed_file_types.split(","))
        self.max_size = settings.max_upload_size_mb * 1024 * 1024

    def _validate(self, filename: str, size: int) -> str:
        """校验文件类型和大小，返回扩展名。"""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in self.allowed_types:
            raise FileUploadError(f"不支持的文件类型: .{ext}，允许: {', '.join(self.allowed_types)}")
        if size > self.max_size:
            raise FileUploadError(f"文件大小超过限制: {settings.max_upload_size_mb}MB")
        return ext

    async def process_upload(
        self,
        file: UploadFile,
        owner_id: str,
        db: AsyncSession,
        uploader_name: str | None = None,
    ) -> Document:
        """处理文件上传全流程。"""
        content_bytes = await file.read()
        file_size = len(content_bytes)
        ext = self._validate(file.filename or "unknown", file_size)

        # 1. 存储文件
        user_dir = os.path.join(settings.upload_dir, owner_id)
        os.makedirs(user_dir, exist_ok=True)
        file_id = str(uuid.uuid4())
        file_path = os.path.join(user_dir, f"{file_id}.{ext}")

        with open(file_path, "wb") as f:
            f.write(content_bytes)

        logger.info("文件已保存: %s (%d bytes)", file_path, file_size)

        # 2. 提取文本 & LLM 解析
        is_image = ext in ("png", "jpg", "jpeg", "gif", "webp", "bmp")
        parsed = {"title": file.filename, "summary": None, "author": None, "tags": [], "category": None}

        if is_image and settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            # 图片文件：用视觉模型识别内容
            try:
                from app.services.llm import llm_client
                parsed = await llm_client.parse_image_file(content_bytes, ext)
                logger.info("视觉模型识别完成: %s", parsed.get("title"))
            except Exception as e:
                logger.warning("视觉模型图片解析失败: %s", e)
            text_content = parsed.get("content_text") or f"[图片文件: {ext}] {file.filename}"
        else:
            # 非图片文件：提取文本后用 LLM 解析
            text_content = self._extract_text(content_bytes, ext)
            if not text_content.strip():
                text_content = f"[{ext} 文件] {file.filename}"
            if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
                try:
                    from app.services.llm import llm_client
                    parsed = await llm_client.parse_uploaded_file(text_content, ext)
                except Exception as e:
                    logger.warning("LLM 文件解析失败: %s", e)

        # 4. 生成 Embedding
        embedding = None
        if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                embed_text = f"{parsed.get('title', '')} {text_content}".strip()
                embedding = await llm_client.generate_embedding(embed_text[:2000])
            except Exception as e:
                logger.warning("Embedding 生成失败: %s", e)

        # 5. 写入 documents 表
        tags_dict = {}
        if isinstance(parsed.get("tags"), list):
            tags_dict = {tag: True for tag in parsed["tags"]}

        doc = Document(
            owner_id=owner_id,
            source_type="local",
            title=parsed.get("title") or file.filename,
            content_text=text_content,
            summary=parsed.get("summary"),
            author=parsed.get("author"),
            tags=tags_dict,
            category=parsed.get("category"),
            file_type=ext,
            file_size=file_size,
            file_path=file_path,
            uploader_name=uploader_name,
            synced_at=datetime.utcnow(),
        )

        if embedding:
            doc.content_vector = embedding

        db.add(doc)
        await db.commit()
        await db.refresh(doc)

        logger.info("文件已入库: doc_id=%d, title=%s", doc.id, doc.title)
        return doc

    @staticmethod
    def _extract_text(content: bytes, ext: str) -> str:
        """从文件内容提取纯文本。"""
        if ext == "txt":
            for encoding in ("utf-8", "gbk", "latin-1"):
                try:
                    return content.decode(encoding)
                except (UnicodeDecodeError, ValueError):
                    continue
            return content.decode("utf-8", errors="replace")

        if ext == "csv":
            for encoding in ("utf-8", "gbk", "latin-1"):
                try:
                    return content.decode(encoding)
                except (UnicodeDecodeError, ValueError):
                    continue
            return content.decode("utf-8", errors="replace")

        if ext == "pdf":
            try:
                from pypdf import PdfReader
                import io
                reader = PdfReader(io.BytesIO(content))
                pages = [page.extract_text() or "" for page in reader.pages]
                return "\n".join(pages)
            except Exception as e:
                logger.warning("PDF 文本提取失败: %s", e)
                return ""

        if ext == "docx":
            try:
                from docx import Document as DocxDocument
                import io
                doc = DocxDocument(io.BytesIO(content))
                return "\n".join(p.text for p in doc.paragraphs)
            except Exception as e:
                logger.warning("DOCX 文本提取失败: %s", e)
                return ""

        if ext in ("xlsx", "xls"):
            try:
                import io
                import csv
                # 简单读取为文本
                return content.decode("utf-8", errors="replace")
            except Exception:
                return ""

        # 图片等非文本文件
        if ext in ("png", "jpg", "jpeg"):
            return f"[图片文件: {ext}]"

        return content.decode("utf-8", errors="replace")


# 模块级单例
file_upload_service = FileUploadService()
