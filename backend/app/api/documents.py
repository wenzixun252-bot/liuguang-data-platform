"""文档管理接口。"""

import asyncio
import logging
import mimetypes
import os
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import String, func, select
from sqlalchemy.sql.expression import cast
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import ContentTag

logger = logging.getLogger(__name__)

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.document import Document
from app.models.tag import TagDefinition
from app.models.user import User
from app.schemas.document import ContentTagBrief, DocumentListResponse, DocumentOut

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
    asset_owner_name: str | None = Query(None),
    file_type: str | None = Query(None),
    extraction_rule_id: int | None = Query(None, description="按提取规则ID筛选"),
    tag_ids: list[int] = Query(default=[]),
    date_field: str | None = Query(None, description="时间筛选字段: created_at, feishu_created_at, feishu_updated_at, synced_at"),
    date_from: datetime | None = Query(None, description="时间范围开始"),
    date_to: datetime | None = Query(None, description="时间范围结束"),
) -> DocumentListResponse:
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    base = select(Document)
    count_stmt = select(func.count()).select_from(Document)

    base = _apply_visibility(base, visible_ids)
    count_stmt = _apply_visibility(count_stmt, visible_ids)

    if search:
        like = f"%{search}%"
        f = (
            Document.title.ilike(like)
            | Document.content_text.ilike(like)
            | Document.summary.ilike(like)
            | Document.original_filename.ilike(like)
            | Document.asset_owner_name.ilike(like)
            | cast(Document.keywords, String).ilike(like)
            | Document.file_type.ilike(like)
            | Document.author.ilike(like)
            | cast(Document.key_info, String).ilike(like)
        )
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

    if asset_owner_name:
        like = f"%{asset_owner_name}%"
        base = base.where(Document.asset_owner_name.ilike(like))
        count_stmt = count_stmt.where(Document.asset_owner_name.ilike(like))

    if file_type:
        base = base.where(Document.file_type == file_type)
        count_stmt = count_stmt.where(Document.file_type == file_type)

    if extraction_rule_id is not None:
        if extraction_rule_id == -999:
            base = base.where(Document.extraction_rule_id.is_(None))
            count_stmt = count_stmt.where(Document.extraction_rule_id.is_(None))
        else:
            base = base.where(Document.extraction_rule_id == extraction_rule_id)
            count_stmt = count_stmt.where(Document.extraction_rule_id == extraction_rule_id)

    if tag_ids:
        subq = select(ContentTag.content_id).where(
            ContentTag.content_type == "document",
            ContentTag.tag_id.in_(tag_ids),
        )
        base = base.where(Document.id.in_(subq))
        count_stmt = count_stmt.where(Document.id.in_(subq))

    # 时间范围筛选
    _date_field_map = {
        "created_at": Document.created_at,
        "feishu_created_at": Document.feishu_created_at,
        "feishu_updated_at": Document.feishu_updated_at,
        "synced_at": Document.synced_at,
    }
    if date_field and date_field in _date_field_map:
        col = _date_field_map[date_field]
        if date_from:
            base = base.where(col >= date_from)
            count_stmt = count_stmt.where(col >= date_from)
        if date_to:
            base = base.where(col <= date_to)
            count_stmt = count_stmt.where(col <= date_to)

    total = (await db.execute(count_stmt)).scalar() or 0
    items_stmt = (
        select(Document, User.name.label("uploader_name"))
        .outerjoin(User, Document.owner_id == User.feishu_open_id)
        .where(Document.id.in_(
            base.with_only_columns(Document.id)
            .order_by(func.coalesce(Document.synced_at, Document.created_at).desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ))
        .order_by(func.coalesce(Document.synced_at, Document.created_at).desc())
    )
    result_rows = (await db.execute(items_stmt)).all()

    rows = [row.Document for row in result_rows]
    uploader_map: dict[int, str | None] = {row.Document.id: row.uploader_name for row in result_rows}

    # 统计每个 feishu_record_id 被多少人归档（按上传人去重）
    frid_list = [r.feishu_record_id for r in rows if r.feishu_record_id]
    import_count_map: dict[str, int] = {}
    if frid_list:
        count_rows = (await db.execute(
            select(
                Document.feishu_record_id,
                func.count(func.coalesce(Document.asset_owner_name, Document.owner_id).distinct()).label("cnt"),
            )
            .where(Document.feishu_record_id.in_(frid_list))
            .group_by(Document.feishu_record_id)
        )).all()
        import_count_map = {row.feishu_record_id: row.cnt for row in count_rows}

    # 回补缺失的飞书创建/修改时间（后台异步执行，不阻塞列表响应）
    need_time_ids = [r.id for r in rows if r.source_type == "cloud" and r.feishu_record_id
                     and (not r.feishu_created_at or not r.feishu_updated_at)]
    if need_time_ids:
        user_token = current_user.feishu_access_token
        user_id = current_user.id
        asyncio.create_task(_backfill_feishu_time(need_time_ids, user_token, user_id))

    # 将 key_info 中的 field_xxx key 翻译为中文 label
    from app.services.etl.enricher import translate_key_info_batch
    await translate_key_info_batch(rows, db)

    # 批量查询当前页所有文档的标签
    doc_ids = [r.id for r in rows]
    tags_map: dict[int, list[ContentTagBrief]] = {}
    if doc_ids:
        tag_rows = (await db.execute(
            select(ContentTag.content_id, ContentTag.id, ContentTag.tag_id,
                   TagDefinition.name, TagDefinition.color)
            .join(TagDefinition, ContentTag.tag_id == TagDefinition.id)
            .where(ContentTag.content_type == "document",
                   ContentTag.content_id.in_(doc_ids))
        )).all()
        for row in tag_rows:
            tags_map.setdefault(row.content_id, []).append(
                ContentTagBrief(id=row.id, tag_id=row.tag_id,
                                tag_name=row.name, tag_color=row.color))

    items = []
    search_lower = search.lower() if search else ""
    for r in rows:
        doc_out = DocumentOut.model_validate(r)
        uname = uploader_map.get(r.id)
        if uname:
            doc_out = doc_out.model_copy(update={"uploader_name": uname})
        if r.feishu_record_id and r.feishu_record_id in import_count_map:
            doc_out = doc_out.model_copy(update={"import_count": import_count_map[r.feishu_record_id]})
        # 计算 matched_fields
        if search_lower:
            matched = []
            fields_to_check = {
                "title": r.title,
                "content_text": r.content_text,
                "summary": r.summary,
                "original_filename": r.original_filename,
                "asset_owner_name": r.asset_owner_name,
                "keywords": " ".join(r.keywords or []),
                "key_info": " ".join(f"{k} {v}" for k, v in (r.key_info or {}).items() if v is not None),
            }
            for fname, val in fields_to_check.items():
                if val and search_lower in str(val).lower():
                    matched.append(fname)
            doc_out = doc_out.model_copy(update={"matched_fields": matched})
        if r.id in tags_map:
            doc_out = doc_out.model_copy(update={"tags": tags_map[r.id]})
        items.append(doc_out)

    return DocumentListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{doc_id}/archivers", summary="文档归档人列表")
async def get_document_archivers(
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """查询该文档的所有归档人（按 feishu_record_id 聚合）。"""
    doc = (await db.execute(
        select(Document.feishu_record_id).where(Document.id == doc_id)
    )).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    if not doc:
        return {"archivers": []}

    rows = (await db.execute(
        select(
            Document.owner_id,
            func.coalesce(User.name, Document.asset_owner_name).label("name"),
            User.avatar_url,
            func.min(Document.created_at).label("archived_at"),
        )
        .outerjoin(User, Document.owner_id == User.feishu_open_id)
        .where(Document.feishu_record_id == doc)
        .group_by(Document.owner_id, User.name, Document.asset_owner_name, User.avatar_url)
    )).all()

    return {"archivers": [
        {
            "name": r.name or "未知用户",
            "avatar_url": r.avatar_url,
            "archived_at": r.archived_at.isoformat() if r.archived_at else None,
        }
        for r in rows
    ]}


@router.get("/{doc_id}", response_model=DocumentOut, summary="文档详情")
async def get_document(
    request: Request,
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DocumentOut:
    visible_ids = await get_visible_owner_ids(current_user, db, request)
    stmt = (
        select(Document, User.name.label("uploader_name"))
        .outerjoin(User, Document.owner_id == User.feishu_open_id)
        .where(Document.id == doc_id)
    )
    stmt = _apply_visibility(stmt, visible_ids)
    row = (await db.execute(stmt)).first()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在或无权访问")
    doc_out = DocumentOut.model_validate(row.Document)
    if row.uploader_name:
        doc_out = doc_out.model_copy(update={"uploader_name": row.uploader_name})
    return doc_out


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
    request: Request,
    doc_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """删除文档（个人模式仅限自己的，管理模式可删任何人的）。"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)
    stmt = select(Document).where(Document.id == doc_id)
    stmt = _apply_visibility(stmt, visible_ids)
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
    request: Request,
    body: BatchDeleteRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """批量删除文档（个人模式仅限自己的，管理模式可删任何人的）。"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)
    stmt = select(Document).where(Document.id.in_(body.ids))
    stmt = _apply_visibility(stmt, visible_ids)
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


@router.patch("/{doc_id}/extraction-rule", summary="绑定或修改文档提取规则")
async def update_doc_extraction_rule(
    request: Request,
    doc_id: int,
    body: dict,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """绑定、修改或解除文档的提取规则。body: { extraction_rule_id: int | null }"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)
    stmt = select(Document).where(Document.id == doc_id)
    stmt = _apply_visibility(stmt, visible_ids)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在或无权操作")

    new_rule_id = body.get("extraction_rule_id")
    if new_rule_id is None:
        doc.extraction_rule_id = None
        doc.key_info = None
        await db.commit()
        return {"message": "已解除提取规则", "extraction_rule_id": None}

    from app.services.etl.enricher import extract_key_info
    content = doc.content_text or ""
    if content:
        key_info = await extract_key_info(content, new_rule_id, db, title=doc.title, original_filename=doc.original_filename)
        doc.key_info = key_info
    doc.extraction_rule_id = new_rule_id
    await db.commit()
    return {
        "message": "提取规则已应用",
        "extraction_rule_id": doc.extraction_rule_id,
        "key_info": doc.key_info,
    }


async def _backfill_feishu_time(doc_ids: list[int], user_token: str | None, user_id: int) -> None:
    """后台回补缺失的飞书文档创建/修改时间，不阻塞 API 响应。"""
    try:
        from app.database import async_session
        from app.api.deps import refresh_user_feishu_token
        from app.services.feishu import feishu_client
        from app.models.user import User as UserModel

        async with async_session() as db:
            rows = (await db.execute(
                select(Document).where(Document.id.in_(doc_ids))
            )).scalars().all()
            if not rows:
                return

            # 如果没有 user_token，尝试刷新
            token = user_token
            if not token:
                user = (await db.execute(
                    select(UserModel).where(UserModel.id == user_id)
                )).scalar_one_or_none()
                if user:
                    token = await refresh_user_feishu_token(user, db)
            if not token:
                return

            doc_tokens = [{"token": r.feishu_record_id, "type": r.file_type or "docx"} for r in rows]
            meta_map = await feishu_client.batch_get_doc_meta(doc_tokens, token)

            changed = False
            for r in rows:
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
        logger.debug("后台回补文档时间戳失败: %s", e)
