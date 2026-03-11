"""文档管理接口。"""

import logging
import mimetypes
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import ContentTag

logger = logging.getLogger(__name__)

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.document import Document
from app.models.user import User
from app.schemas.document import DocumentListResponse, DocumentOut

router = APIRouter(prefix="/api/documents", tags=["文档"])


def _apply_visibility(stmt, visible_ids: list[str] | None):
    """按可见 owner_id 列表过滤。"""
    if visible_ids is not None:
        stmt = stmt.where(Document.owner_id.in_(visible_ids))
    return stmt


@router.get("/list", response_model=DocumentListResponse, summary="文档列表")
async def list_documents(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    source_type: str | None = Query(None),
    doc_category: str | None = Query(None),
    sentiment: str | None = Query(None),
    uploader_name: str | None = Query(None),
    tag_ids: list[int] = Query(default=[]),
) -> DocumentListResponse:
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    base = select(Document)
    count_stmt = select(func.count()).select_from(Document)

    base = _apply_visibility(base, visible_ids)
    count_stmt = _apply_visibility(count_stmt, visible_ids)

    if search:
        like = f"%{search}%"
        f = Document.title.ilike(like) | Document.content_text.ilike(like)
        base = base.where(f)
        count_stmt = count_stmt.where(f)

    if source_type:
        base = base.where(Document.source_type == source_type)
        count_stmt = count_stmt.where(Document.source_type == source_type)

    if doc_category:
        base = base.where(Document.doc_category == doc_category)
        count_stmt = count_stmt.where(Document.doc_category == doc_category)

    if sentiment:
        base = base.where(Document.sentiment == sentiment)
        count_stmt = count_stmt.where(Document.sentiment == sentiment)

    if uploader_name:
        like = f"%{uploader_name}%"
        base = base.where(Document.uploader_name.ilike(like))
        count_stmt = count_stmt.where(Document.uploader_name.ilike(like))

    if tag_ids:
        subq = select(ContentTag.content_id).where(
            ContentTag.content_type == "document",
            ContentTag.tag_id.in_(tag_ids),
        )
        base = base.where(Document.id.in_(subq))
        count_stmt = count_stmt.where(Document.id.in_(subq))

    total = (await db.execute(count_stmt)).scalar() or 0
    items_stmt = base.order_by(Document.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(items_stmt)).scalars().all()

    # 统计每个 feishu_record_id 被多少人归档（一次批量查询）
    frid_list = [r.feishu_record_id for r in rows if r.feishu_record_id]
    import_count_map: dict[str, int] = {}
    if frid_list:
        count_rows = (await db.execute(
            select(Document.feishu_record_id, func.count(Document.owner_id.distinct()).label("cnt"))
            .where(Document.feishu_record_id.in_(frid_list))
            .group_by(Document.feishu_record_id)
        )).all()
        import_count_map = {row.feishu_record_id: row.cnt for row in count_rows}

    # 回补缺失的飞书创建/修改时间（一次性批量查询，仅对当页缺失的云文档）
    need_time = [r for r in rows if r.source_type == "cloud" and r.feishu_record_id
                 and (not r.feishu_created_at or not r.feishu_updated_at)]
    if need_time:
        try:
            from datetime import datetime
            from app.api.deps import refresh_user_feishu_token
            from app.services.feishu import feishu_client
            user_token = current_user.feishu_access_token
            if not user_token:
                user_token = await refresh_user_feishu_token(current_user, db)
            doc_tokens = [{"token": r.feishu_record_id, "type": r.file_type or "docx"} for r in need_time]
            meta_map = await feishu_client.batch_get_doc_meta(doc_tokens, user_token)
            changed = False
            for r in need_time:
                meta = meta_map.get(r.feishu_record_id, {})
                if meta.get("create_time") and not r.feishu_created_at:
                    r.feishu_created_at = datetime.utcfromtimestamp(int(meta["create_time"]))
                    changed = True
                if meta.get("latest_modify_time") and not r.feishu_updated_at:
                    r.feishu_updated_at = datetime.utcfromtimestamp(int(meta["latest_modify_time"]))
                    changed = True
            if changed:
                await db.commit()
        except Exception as e:
            logger.debug("回补文档时间戳失败: %s", e)

    # 将 key_info 中的 field_xxx key 翻译为中文 label
    from app.services.etl.enricher import translate_key_info_batch
    await translate_key_info_batch(rows, db)

    items = []
    for r in rows:
        doc_out = DocumentOut.model_validate(r)
        if r.feishu_record_id and r.feishu_record_id in import_count_map:
            doc_out = doc_out.model_copy(update={"import_count": import_count_map[r.feishu_record_id]})
        items.append(doc_out)

    return DocumentListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{doc_id}", response_model=DocumentOut, summary="文档详情")
async def get_document(
    request: Request,
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DocumentOut:
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    stmt = select(Document).where(Document.id == doc_id)
    stmt = _apply_visibility(stmt, visible_ids)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在或无权访问")
    return DocumentOut.model_validate(row)


@router.get("/{doc_id}/download", summary="下载本地上传的文档")
async def download_document(
    request: Request,
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileResponse:
    """下载本地上传的文档文件。"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    stmt = select(Document).where(Document.id == doc_id)
    stmt = _apply_visibility(stmt, visible_ids)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="文档不存在或无权访问")
    if not row.file_path or not os.path.exists(row.file_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    content_type, _ = mimetypes.guess_type(row.file_path)
    return FileResponse(
        path=row.file_path,
        media_type=content_type or "application/octet-stream",
        filename=os.path.basename(row.file_path),
    )


@router.delete("/{doc_id}", summary="删除文档")
async def delete_document(
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """删除用户自己上传或同步的文档（仅限 owner 或 admin）。"""
    stmt = select(Document).where(Document.id == doc_id)
    if current_user.role != "admin":
        stmt = stmt.where(Document.owner_id == current_user.feishu_open_id)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="文档不存在或无权删除")

    # 删除磁盘文件（本地上传的文件）
    if row.file_path and os.path.exists(row.file_path):
        try:
            os.remove(row.file_path)
            logger.info("已删除磁盘文件: %s", row.file_path)
        except OSError as e:
            logger.warning("删除磁盘文件失败: %s, %s", row.file_path, e)

    await db.delete(row)
    await db.commit()
    return {"message": "已删除"}


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/batch-delete", summary="批量删除文档")
async def batch_delete_documents(
    body: BatchDeleteRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """批量删除文档（仅限 owner 或 admin）。"""
    stmt = select(Document).where(Document.id.in_(body.ids))
    if current_user.role != "admin":
        stmt = stmt.where(Document.owner_id == current_user.feishu_open_id)
    rows = (await db.execute(stmt)).scalars().all()

    for row in rows:
        if row.file_path and os.path.exists(row.file_path):
            try:
                os.remove(row.file_path)
            except OSError as e:
                logger.warning("删除磁盘文件失败: %s, %s", row.file_path, e)
        await db.delete(row)

    await db.commit()
    return {"deleted": len(rows)}
