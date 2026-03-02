"""文件上传接口。"""

import glob as globmod
import logging
import mimetypes
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.document import Document
from app.models.user import User
from app.schemas.document import DocumentOut
from app.services.file_upload import FileUploadError, file_upload_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload", tags=["文件上传"])


@router.post("/file", response_model=DocumentOut, summary="上传文件并解析入库")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    """上传文件，自动提取文本、LLM 解析结构化字段、生成 Embedding，写入 documents 表。"""
    try:
        doc = await file_upload_service.process_upload(
            file=file,
            owner_id=current_user.feishu_open_id,
            db=db,
            uploader_name=current_user.name,
        )
        return DocumentOut.model_validate(doc)
    except FileUploadError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
