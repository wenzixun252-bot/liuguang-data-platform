"""文件上传接口。"""

import glob as globmod
import json
import logging
import mimetypes
import os
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.document import Document
from app.models.tag import ContentTag
from app.models.user import User
from app.schemas.document import DocumentOut
from app.schemas.communication import CommunicationOut
from app.services.file_upload import FileUploadError, file_upload_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload", tags=["文件上传"])


@router.post("/file", response_model=DocumentOut, summary="上传文件并解析入库")
async def upload_file(
    file: UploadFile = File(...),
    tag_ids: str | None = Form(None),
    extraction_rule_id: int | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    """上传文件，自动提取文本、LLM 解析结构化字段、生成 Embedding，写入 documents 表。
    tag_ids: 逗号分隔的标签 ID（可选），如 "1,3,7"。
    extraction_rule_id: 可选的提取规则 ID，用于 LLM 关键信息提取。
    """
    try:
        doc = await file_upload_service.process_upload(
            file=file,
            owner_id=current_user.feishu_open_id,
            db=db,
            asset_owner_name=current_user.name,
        )
        await db.commit()
        await db.refresh(doc)

        # 如果指定了提取规则，执行关键信息提取
        if extraction_rule_id:
            from app.services.etl.enricher import extract_key_info
            doc.extraction_rule_id = extraction_rule_id
            try:
                key_info = await extract_key_info(doc.content_text, extraction_rule_id, db, title=doc.title, original_filename=doc.original_filename)
                if key_info:
                    doc.key_info = key_info
            except Exception as e:
                logger.warning("文档 key_info 提取失败 (doc_id=%s): %s", doc.id, e)
            await db.commit()
            await db.refresh(doc)

        # 写入用户指定的标签
        if tag_ids:
            for tid_str in tag_ids.split(","):
                tid_str = tid_str.strip()
                if tid_str.isdigit():
                    db.add(ContentTag(
                        tag_id=int(tid_str),
                        content_type="document",
                        content_id=doc.id,
                        tagged_by="user_manual",
                    ))
            await db.commit()

        # LLM 自动标签推荐（硬性规定：必须至少打上一个标签）
        try:
            from app.services.llm import auto_tag_content
            content = doc.summary or (doc.content_text or "")[:2000]
            tagged = await auto_tag_content(db, doc.id, "document", content, current_user.feishu_open_id)
            if tagged:
                await db.commit()
                logger.info("自动标签推荐: doc_id=%d, 新增 %d 个标签", doc.id, tagged)
        except Exception as e_tag:
            logger.error("自动标签推荐失败 (doc_id=%d): %s", doc.id, e_tag, exc_info=True)

        # 硬性保底：确认文档至少有一个标签，没有则强制打「其他」
        try:
            from sqlalchemy import text as sql_text
            check = await db.execute(
                sql_text("SELECT COUNT(*) FROM content_tags WHERE content_type = 'document' AND content_id = :cid"),
                {"cid": doc.id},
            )
            if (check.scalar() or 0) == 0:
                from app.services.llm import _force_apply_other_tag
                await _force_apply_other_tag(db, doc.id, "document", current_user.feishu_open_id)
                await db.commit()
                logger.warning("硬性保底: doc_id=%d 无标签, 已强制打上「其他」", doc.id)
        except Exception as e_fallback:
            logger.error("硬性保底打标也失败 (doc_id=%d): %s", doc.id, e_fallback, exc_info=True)

        return DocumentOut.model_validate(doc)
    except FileUploadError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("文件上传处理异常: %s", e)
        raise HTTPException(status_code=500, detail=f"文件处理失败: {e}")


@router.post("/communication", response_model=CommunicationOut, summary="上传音频文件并解析为沟通资产")
async def upload_communication(
    file: UploadFile = File(...),
    metadata: str | None = Form(None),
    tag_ids: str | None = Form(None),
    extraction_rule_id: int | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommunicationOut:
    """上传音频文件（MP3/WAV/M4A等），自动ASR转文字、LLM提取结构化字段，写入communications表。
    metadata: JSON字符串，用户补充的元数据，如 {"title":"周会","comm_type":"meeting","participants":["张三"],"comm_time":"2026-03-10T14:00","context":"Q2需求讨论"}
    extraction_rule_id: 提取规则 ID（可选），指定后会自动提取关键信息。
    """
    # 解析用户提供的元数据
    user_metadata = {}
    if metadata:
        try:
            user_metadata = json.loads(metadata)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="metadata 格式不正确，请传入 JSON 字符串")

    try:
        comm = await file_upload_service.process_communication_upload(
            file=file,
            owner_id=current_user.feishu_open_id,
            db=db,
            asset_owner_name=current_user.name,
            user_metadata=user_metadata,
        )
        await db.commit()
        await db.refresh(comm)

        # 如果指定了提取规则，保存并执行关键信息提取
        if extraction_rule_id:
            from app.services.etl.enricher import extract_key_info
            comm.extraction_rule_id = extraction_rule_id
            try:
                key_info = await extract_key_info(comm.content_text, extraction_rule_id, db, title=comm.title)
                if key_info:
                    comm.key_info = key_info
            except Exception as e:
                logger.warning("沟通资产 key_info 提取失败 (comm_id=%s): %s", comm.id, e)
            await db.commit()
            await db.refresh(comm)

        # 写入用户指定的标签
        if tag_ids:
            for tid_str in tag_ids.split(","):
                tid_str = tid_str.strip()
                if tid_str.isdigit():
                    db.add(ContentTag(
                        tag_id=int(tid_str),
                        content_type="communication",
                        content_id=comm.id,
                        tagged_by="user_manual",
                    ))
            await db.commit()

        # LLM 自动标签推荐（硬性规定：必须至少打上一个标签）
        try:
            from app.services.llm import auto_tag_content
            content = comm.summary or (comm.content_text or "")[:2000]
            tagged = await auto_tag_content(db, comm.id, "communication", content, current_user.feishu_open_id)
            if tagged:
                await db.commit()
                logger.info("自动标签推荐: comm_id=%d, 新增 %d 个标签", comm.id, tagged)
        except Exception as e_tag:
            logger.error("自动标签推荐失败 (comm_id=%d): %s", comm.id, e_tag, exc_info=True)

        # 硬性保底：确认至少有一个标签
        try:
            from sqlalchemy import text as sql_text
            check = await db.execute(
                sql_text("SELECT COUNT(*) FROM content_tags WHERE content_type = 'communication' AND content_id = :cid"),
                {"cid": comm.id},
            )
            if (check.scalar() or 0) == 0:
                from app.services.llm import _force_apply_other_tag
                await _force_apply_other_tag(db, comm.id, "communication", current_user.feishu_open_id)
                await db.commit()
                logger.warning("硬性保底: comm_id=%d 无标签, 已强制打上「其他」", comm.id)
        except Exception as e_fallback:
            logger.error("硬性保底打标也失败 (comm_id=%d): %s", comm.id, e_fallback, exc_info=True)

        return CommunicationOut.model_validate(comm)
    except FileUploadError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("音频上传处理异常: %s", e)
        raise HTTPException(status_code=500, detail=f"音频处理失败: {e}")


@router.delete("/file/{doc_id}", summary="删除当前用户上传的文件")
async def delete_uploaded_file(
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """删除用户自己上传的文件（数据库记录 + 磁盘文件）。"""
    result = await db.execute(
        select(Document).where(
            Document.id == doc_id,
            Document.owner_id == current_user.feishu_open_id,
            Document.source_type == "local",
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在或无权删除")

    # 删除磁盘文件
    if doc.file_path and os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
            logger.info("已删除磁盘文件: %s", doc.file_path)
        except OSError as e:
            logger.warning("删除磁盘文件失败: %s, %s", doc.file_path, e)

    await db.delete(doc)
    await db.commit()
    return {"message": "已删除"}


@router.get("/attachments/{file_token}", summary="下载/查看附件文件")
async def get_attachment(file_token: str) -> FileResponse:
    """根据 file_token 返回附件文件（file_token 本身即为访问凭证）。"""
    base_dir = os.path.join("uploads", "attachments")

    # 在所有用户目录中查找
    pattern = os.path.join(base_dir, "*", f"{file_token}.*")
    matches = globmod.glob(pattern)

    if not matches:
        raise HTTPException(status_code=404, detail="附件不存在")

    file_path = matches[0]
    content_type, _ = mimetypes.guess_type(file_path)
    is_image = content_type and content_type.startswith("image/")

    resp = FileResponse(
        path=file_path,
        media_type=content_type or "application/octet-stream",
    )
    # 图片内联显示，其他文件下载
    fname = os.path.basename(file_path)
    if is_image:
        resp.headers["Content-Disposition"] = f'inline; filename="{fname}"'
    else:
        resp.headers["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp


@router.get("/files", response_model=list[DocumentOut], summary="查看当前用户上传的文件")
async def list_uploaded_files(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DocumentOut]:
    """返回当前用户上传的本地文件列表。"""
    result = await db.execute(
        select(Document)
        .where(
            Document.owner_id == current_user.feishu_open_id,
            Document.source_type == "local",
        )
        .order_by(Document.created_at.desc())
    )
    docs = result.scalars().all()
    return [DocumentOut.model_validate(d) for d in docs]
