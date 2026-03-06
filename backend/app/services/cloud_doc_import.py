"""飞书云文档/文件导入服务 — 云文档通过 Block API 读取，飞书文件通过下载后本地提取。"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import Document
from app.services.feishu import feishu_client, FeishuAPIError

logger = logging.getLogger(__name__)

# 飞书文件中支持本地文本提取的扩展名
EXTRACTABLE_FILE_EXTENSIONS = {"pdf", "docx", "doc", "txt", "csv", "xlsx", "xls", "pptx", "ppt"}
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}


@dataclass
class ImportResult:
    """批量导入结果统计。"""
    imported: int = 0
    skipped: int = 0
    failed: int = 0
    documents: list = field(default_factory=list)


class CloudDocImportService:
    """飞书云文档/文件导入服务。"""

    async def import_cloud_doc(
        self,
        document_id: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        uploader_name: str | None = None,
        force: bool = False,
    ) -> tuple[Document | None, str]:
        """导入飞书云文档（docx/doc 类型），通过 Block API 读取内容。

        Returns:
            (Document, status) — status: "imported" | "skipped" | "failed"
        """
        try:
            # 1. 检查是否已导入
            existing = await self._find_existing(db, document_id, owner_id)
            if existing and not force:
                logger.info("云文档已导入，跳过: %s", document_id)
                return existing, "skipped"

            # 2. 通过 Block API 获取文档内容
            doc_content = await feishu_client.get_document_content(
                document_id, user_access_token=user_access_token,
            )
            title = doc_content["title"]
            content_text = doc_content["content_text"]

            if not content_text.strip():
                content_text = f"[空文档] {title}"

            # 3. 对已存在的文档检查是否有更新
            if existing and not force:
                modified_time = doc_content.get("modified_time")
                if modified_time and existing.feishu_updated_at:
                    new_ts = datetime.fromtimestamp(int(modified_time))
                    if new_ts <= existing.feishu_updated_at:
                        logger.info("云文档未更新，跳过: %s", document_id)
                        return existing, "skipped"

            # 4. LLM 结构化解析
            parsed = await self._llm_parse(content_text, "docx")

            # 5. 生成 Embedding
            embedding = await self._generate_embedding(title, content_text)

            # 6. 构建文档 URL
            domain = settings.feishu_base_domain or "feishu.cn"
            source_url = f"https://{domain}/docx/{document_id}"

            # 7. 构建时间戳
            created_time = doc_content.get("created_time")
            modified_time = doc_content.get("modified_time")
            feishu_created = datetime.fromtimestamp(int(created_time)) if created_time else None
            feishu_updated = datetime.fromtimestamp(int(modified_time)) if modified_time else None

            # 8. Upsert
            keywords_list = parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else []

            if existing:
                # 更新现有记录
                existing.title = parsed.get("title") or title
                existing.content_text = content_text
                existing.summary = parsed.get("summary")
                existing.author = parsed.get("author")
                existing.keywords = keywords_list
                existing.source_url = source_url
                existing.feishu_created_at = feishu_created
                existing.feishu_updated_at = feishu_updated
                existing.synced_at = datetime.utcnow()
                if embedding:
                    existing.content_vector = embedding
                await db.commit()
                await db.refresh(existing)
                logger.info("云文档已更新: doc_id=%d, title=%s", existing.id, existing.title)
                return existing, "imported"
            else:
                doc = Document(
                    owner_id=owner_id,
                    source_type="cloud",
                    feishu_record_id=document_id,
                    title=parsed.get("title") or title,
                    content_text=content_text,
                    summary=parsed.get("summary"),
                    author=parsed.get("author"),
                    keywords=keywords_list,
                    file_type="docx",
                    source_url=source_url,
                    uploader_name=uploader_name,
                    feishu_created_at=feishu_created,
                    feishu_updated_at=feishu_updated,
                    synced_at=datetime.utcnow(),
                )
                if embedding:
                    doc.content_vector = embedding
                db.add(doc)
                await db.commit()
                await db.refresh(doc)
                logger.info("云文档已导入: doc_id=%d, title=%s", doc.id, doc.title)
                return doc, "imported"

        except Exception as e:
            logger.error("导入云文档失败 [%s]: %s", document_id, e)
            return None, "failed"

    async def import_cloud_file(
        self,
        file_token: str,
        file_name: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        uploader_name: str | None = None,
        force: bool = False,
    ) -> tuple[Document | None, str]:
        """导入飞书文件（PDF/PPT 等），先下载再本地提取文本。

        Returns:
            (Document, status) — status: "imported" | "skipped" | "failed"
        """
        try:
            # 1. 检查是否已导入
            existing = await self._find_existing(db, file_token, owner_id)
            if existing and not force:
                logger.info("飞书文件已导入，跳过: %s", file_token)
                return existing, "skipped"

            # 2. 获取文件扩展名
            ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
            # 飞书 Drive 返回的文件名可能不带扩展名，此时尝试当作通用文件处理
            if ext == file_name.lower() or not ext:
                ext = ""
                logger.info("文件 %s 无法识别扩展名，将尝试通用处理", file_name)
            if ext and ext not in EXTRACTABLE_FILE_EXTENSIONS and ext not in IMAGE_EXTENSIONS:
                logger.warning("不支持的文件类型: %s (%s)", file_name, ext)
                return None, "failed"

            # 3. 下载文件（Drive 文件用 download_drive_file，不是 download_media）
            content_bytes = await feishu_client.download_drive_file(
                file_token, user_access_token=user_access_token,
            )
            file_size = len(content_bytes)
            logger.info("文件已下载: %s (%d bytes)", file_name, file_size)

            # 4. 提取文本 & LLM 解析
            is_image = ext in IMAGE_EXTENSIONS
            parsed = {"title": file_name, "summary": None, "author": None, "tags": [], "category": None}

            if is_image:
                parsed, content_text = await self._parse_image(content_bytes, ext, file_name)
            elif ext:
                content_text = self._extract_text(content_bytes, ext)
                if not content_text.strip():
                    content_text = f"[{ext} 文件] {file_name}"
                parsed = await self._llm_parse(content_text, ext)
            else:
                # 无扩展名，尝试根据内容头部判断格式
                ext = self._guess_extension(content_bytes) or "bin"
                if ext in EXTRACTABLE_FILE_EXTENSIONS:
                    content_text = self._extract_text(content_bytes, ext)
                else:
                    content_text = content_bytes.decode("utf-8", errors="replace")[:10000]
                if not content_text.strip():
                    content_text = f"[文件] {file_name}"
                parsed = await self._llm_parse(content_text, ext)

            # 5. 生成 Embedding
            embedding = await self._generate_embedding(
                parsed.get("title") or file_name, content_text,
            )

            # 6. 构建文档 URL
            domain = settings.feishu_base_domain or "feishu.cn"
            source_url = f"https://{domain}/file/{file_token}"

            # 7. Upsert
            keywords_list = parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else []

            if existing:
                existing.title = parsed.get("title") or file_name
                existing.content_text = content_text
                existing.summary = parsed.get("summary")
                existing.author = parsed.get("author")
                existing.keywords = keywords_list
                existing.file_type = ext
                existing.file_size = file_size
                existing.source_url = source_url
                existing.synced_at = datetime.utcnow()
                if embedding:
                    existing.content_vector = embedding
                await db.commit()
                await db.refresh(existing)
                logger.info("飞书文件已更新: doc_id=%d, title=%s", existing.id, existing.title)
                return existing, "imported"
            else:
                doc = Document(
                    owner_id=owner_id,
                    source_type="cloud",
                    feishu_record_id=file_token,
                    title=parsed.get("title") or file_name,
                    content_text=content_text,
                    summary=parsed.get("summary"),
                    author=parsed.get("author"),
                    keywords=keywords_list,
                    file_type=ext,
                    file_size=file_size,
                    source_url=source_url,
                    uploader_name=uploader_name,
                    synced_at=datetime.utcnow(),
                )
                if embedding:
                    doc.content_vector = embedding
                db.add(doc)
                await db.commit()
                await db.refresh(doc)
                logger.info("飞书文件已导入: doc_id=%d, title=%s", doc.id, doc.title)
                return doc, "imported"

        except Exception as e:
            logger.error("导入飞书文件失败 [%s]: %s", file_token, e)
            return None, "failed"

    async def import_item(
        self,
        file_info: dict,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        uploader_name: str | None = None,
        force: bool = False,
    ) -> tuple[Document | None, str]:
        """路由方法 — 根据文件类型分发到不同处理逻辑。

        Args:
            file_info: 飞书 Drive API 返回的文件信息，包含 token, name, type
        """
        file_type = file_info.get("type", "")
        token = file_info.get("token", "")
        name = file_info.get("name", "未命名")

        if file_type in ("docx", "doc"):
            return await self.import_cloud_doc(
                token, owner_id, db, user_access_token, uploader_name, force=force,
            )
        elif file_type == "file":
            return await self.import_cloud_file(
                token, name, owner_id, db, user_access_token, uploader_name, force=force,
            )
        elif file_type == "wiki":
            # wiki 节点需要先解析实际类型
            try:
                node = await feishu_client.get_wiki_node_info(token, user_access_token=user_access_token)
                obj_type = node.get("obj_type", "")
                obj_token = node.get("obj_token", token)
                if obj_type in ("docx", "doc"):
                    return await self.import_cloud_doc(
                        obj_token, owner_id, db, user_access_token, uploader_name, force=force,
                    )
                elif obj_type == "file":
                    return await self.import_cloud_file(
                        obj_token, name, owner_id, db, user_access_token, uploader_name, force=force,
                    )
                else:
                    logger.warning("wiki 节点实际类型不支持导入: %s (%s → %s)", name, token, obj_type)
                    return None, "failed"
            except Exception as e:
                logger.warning("wiki 节点解析失败: %s (%s): %s", name, token, e)
                return None, "failed"
        else:
            logger.warning("不支持的飞书文件类型: %s (%s)", name, file_type)
            return None, "failed"

    async def fast_import_item(
        self,
        file_info: dict,
        owner_id: str,
        db: AsyncSession,
        uploader_name: str | None = None,
        tag_ids: list[int] | None = None,
    ) -> tuple[Document | None, str]:
        """快速导入 — 仅保存文档元数据，不调用飞书内容 API 和 LLM。

        新导入的文档 parse_status 设为 "pending"，后台任务会异步处理内容解析和向量生成。
        """
        token = file_info.get("token", "")
        name = file_info.get("name", "未命名")
        doc_type = file_info.get("type", "docx")
        url = file_info.get("url", "")

        if not token:
            return None, "failed"

        try:
            existing = await self._find_existing(db, token, owner_id)
            if existing:
                if tag_ids:
                    await self._apply_tags(existing.id, tag_ids, db)
                return existing, "skipped"

            if not url:
                domain = settings.feishu_base_domain or "feishu.cn"
                url = f"https://{domain}/docx/{token}"

            doc = Document(
                owner_id=owner_id,
                source_type="cloud",
                feishu_record_id=token,
                title=name,
                content_text="",
                file_type=doc_type,
                source_url=url,
                uploader_name=uploader_name,
                parse_status="pending",
                synced_at=datetime.utcnow(),
            )
            db.add(doc)
            await db.commit()
            await db.refresh(doc)

            if tag_ids:
                await self._apply_tags(doc.id, tag_ids, db)

            logger.info("快速导入文档元数据: token=%s, title=%s", token, name)
            return doc, "imported"

        except Exception as e:
            logger.error("快速导入失败 [%s]: %s", token, e)
            return None, "failed"

    async def batch_import(
        self,
        file_infos: list[dict],
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        uploader_name: str | None = None,
        tag_ids: list[int] | None = None,
    ) -> ImportResult:
        """批量导入多个云文档/文件，QPS 控制。

        Args:
            tag_ids: 导入成功后自动打上的标签 ID 列表（来自关键词规则的 default_tag_ids）
        """
        result = ImportResult()

        for info in file_infos:
            doc, status = await self.import_item(
                info, owner_id, db, user_access_token, uploader_name,
            )
            if status == "imported":
                result.imported += 1
                if doc:
                    result.documents.append(doc)
                    # 应用默认标签
                    if tag_ids:
                        await self._apply_tags(doc.id, tag_ids, db)
            elif status == "skipped":
                result.skipped += 1
                if doc:
                    result.documents.append(doc)
                    # 跳过的文档也补打标签（可能是新加的标签）
                    if tag_ids:
                        await self._apply_tags(doc.id, tag_ids, db)
            else:
                result.failed += 1

            # QPS 控制
            await asyncio.sleep(0.5)

        return result

    async def sync_folder(
        self,
        folder_token: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        uploader_name: str | None = None,
    ) -> ImportResult:
        """同步飞书文件夹下所有文档/文件。"""
        # 1. 获取文件夹下的文件列表
        files = await feishu_client.list_folder_files(
            folder_token, user_access_token=user_access_token,
        )
        logger.info("文件夹 %s 中发现 %d 个支持的文件", folder_token, len(files))

        # 2. 逐个导入
        return await self.batch_import(
            files, owner_id, db, user_access_token, uploader_name,
        )

    # ── 内部辅助方法 ───────────────────────────────────────

    @staticmethod
    async def _apply_tags(doc_id: int, tag_ids: list[int], db: AsyncSession) -> None:
        """给文档打上指定标签（幂等，重复打不会报错）。"""
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from app.models.tag import ContentTag

        for tag_id in tag_ids:
            try:
                stmt = pg_insert(ContentTag).values(
                    tag_id=tag_id,
                    content_type="document",
                    content_id=doc_id,
                    tagged_by="source_inherit",
                    confidence=1.0,
                ).on_conflict_do_nothing(
                    index_elements=["tag_id", "content_type", "content_id"]
                )
                await db.execute(stmt)
            except Exception as e:
                logger.warning("给文档 %d 打标签 %d 失败: %s", doc_id, tag_id, e)
        await db.commit()

    @staticmethod
    async def _fetch_doc_content(document_id: str, user_access_token: str) -> dict:
        """调用飞书 Block API 获取云文档内容（title + content_text + created/modified_time）。"""
        return await feishu_client.get_document_content(
            document_id, user_access_token=user_access_token,
        )

    @staticmethod
    async def _find_existing(db: AsyncSession, feishu_record_id: str, owner_id: str) -> Document | None:
        """查找已导入的文档记录。"""
        stmt = select(Document).where(
            Document.feishu_record_id == feishu_record_id,
            Document.owner_id == owner_id,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def _llm_parse(content_text: str, file_type: str) -> dict:
        """调用 LLM 结构化解析文本内容。"""
        default = {"title": None, "summary": None, "author": None, "tags": [], "category": None}
        if not settings.llm_api_key or settings.llm_api_key.startswith("sk-xxx"):
            return default
        try:
            from app.services.llm import llm_client
            return await llm_client.parse_uploaded_file(content_text, file_type)
        except Exception as e:
            logger.warning("LLM 解析失败: %s", e)
            return default

    @staticmethod
    async def _generate_embedding(title: str, content_text: str) -> list[float] | None:
        """生成文本向量。"""
        if not settings.embedding_api_key or settings.embedding_api_key.startswith("sk-xxx"):
            return None
        try:
            from app.services.llm import llm_client
            embed_text = f"{title} {content_text}".strip()
            return await llm_client.generate_embedding(embed_text[:2000])
        except Exception as e:
            logger.warning("Embedding 生成失败: %s", e)
            return None

    @staticmethod
    async def _parse_image(content_bytes: bytes, ext: str, file_name: str) -> tuple[dict, str]:
        """解析图片文件。"""
        parsed = {"title": file_name, "summary": None, "author": None, "tags": [], "category": None}
        content_text = f"[图片文件: {ext}] {file_name}"

        if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                parsed = await llm_client.parse_image_file(content_bytes, ext)
                content_text = parsed.get("content_text") or content_text
            except Exception as e:
                logger.warning("图片解析失败: %s", e)

        return parsed, content_text

    @staticmethod
    def _extract_text(content_bytes: bytes, ext: str) -> str:
        """从文件二进制内容提取纯文本（复用 FileUploadService 的逻辑）。"""
        from app.services.file_upload import FileUploadService
        return FileUploadService._extract_text(content_bytes, ext)

    @staticmethod
    def _guess_extension(content_bytes: bytes) -> str | None:
        """根据文件头部魔数猜测文件扩展名。"""
        if len(content_bytes) < 8:
            return None
        header = content_bytes[:8]
        if header[:4] == b"%PDF":
            return "pdf"
        if header[:4] == b"PK\x03\x04":
            # ZIP 格式：可能是 docx/pptx/xlsx
            if b"word/" in content_bytes[:2000]:
                return "docx"
            if b"ppt/" in content_bytes[:2000]:
                return "pptx"
            if b"xl/" in content_bytes[:2000]:
                return "xlsx"
            return "docx"  # 默认当 docx 处理
        if header[:2] == b"\xff\xd8":
            return "jpg"
        if header[:4] == b"\x89PNG":
            return "png"
        return None


# 模块级单例
cloud_doc_import_service = CloudDocImportService()
