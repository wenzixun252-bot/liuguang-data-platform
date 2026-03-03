"""文档管理接口。"""

import logging
import mimetypes
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    source_type: str | None = Query(None),
    category: str | None = Query(None),
    uploader_name: str | None = Query(None),
) -> DocumentListResponse:
    visible_ids = await get_visible_owner_ids(current_user, db)

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

    if category:
        base = base.where(Document.category == category)
        count_stmt = count_stmt.where(Document.category == category)

    if uploader_name:
        like = f"%{uploader_name}%"
        base = base.where(Document.uploader_name.ilike(like))
        count_stmt = count_stmt.where(Document.uploader_name.ilike(like))

    total = (await db.execute(count_stmt)).scalar() or 0
    items_stmt = base.order_by(Document.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(items_stmt)).scalars().all()

    return DocumentListResponse(
        items=[DocumentOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{doc_id}", response_model=DocumentOut, summary="文档详情")
async def get_document(
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DocumentOut:
    visible_ids = await get_visible_owner_ids(current_user, db)

    stmt = select(Document).where(Document.id == doc_id)
    stmt = _apply_visibility(stmt, visible_ids)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在或无权访问")
    return DocumentOut.model_validate(row)


@router.get("/{doc_id}/download", summary="下载本地上传的文档")
async def download_document(
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileResponse:
    """下载本地上传的文档文件。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

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
