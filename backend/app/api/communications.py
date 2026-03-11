"""沟通资产管理接口。"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.communication import Communication
from app.models.tag import ContentTag
from app.models.user import User
from app.schemas.communication import CommunicationListResponse, CommunicationOut

router = APIRouter(prefix="/api/communications", tags=["communications"])


def _apply_visibility(stmt, visible_ids: list[str] | None):
    if visible_ids is not None:
        stmt = stmt.where(Communication.owner_id.in_(visible_ids))
    return stmt


@router.get("/list", response_model=CommunicationListResponse, summary="沟通记录列表")
async def list_communications(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    comm_type: str | None = Query(None),
    search: str | None = Query(None),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    initiator: str | None = Query(None),
    tag_ids: list[int] = Query(default=[]),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> CommunicationListResponse:
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    base = select(Communication)
    count_stmt = select(func.count()).select_from(Communication)

    base = _apply_visibility(base, visible_ids)
    count_stmt = _apply_visibility(count_stmt, visible_ids)

    if comm_type:
        if comm_type == "meeting":
            # "会议（含录音）" 包含 meeting 和 recording 两种类型
            types = ["meeting", "recording"]
            base = base.where(Communication.comm_type.in_(types))
            count_stmt = count_stmt.where(Communication.comm_type.in_(types))
        else:
            base = base.where(Communication.comm_type == comm_type)
            count_stmt = count_stmt.where(Communication.comm_type == comm_type)

    if search:
        like = f"%{search}%"
        f = (
            Communication.title.ilike(like)
            | Communication.content_text.ilike(like)
            | Communication.summary.ilike(like)
            | Communication.initiator.ilike(like)
        )
        base = base.where(f)
        count_stmt = count_stmt.where(f)

    if start_date:
        base = base.where(Communication.comm_time >= start_date)
        count_stmt = count_stmt.where(Communication.comm_time >= start_date)

    if end_date:
        base = base.where(Communication.comm_time <= end_date)
        count_stmt = count_stmt.where(Communication.comm_time <= end_date)

    if initiator:
        like = f"%{initiator}%"
        base = base.where(Communication.initiator.ilike(like))
        count_stmt = count_stmt.where(Communication.initiator.ilike(like))

    if tag_ids:
        subq = select(ContentTag.content_id).where(
            ContentTag.content_type == "communication",
            ContentTag.tag_id.in_(tag_ids),
        )
        base = base.where(Communication.id.in_(subq))
        count_stmt = count_stmt.where(Communication.id.in_(subq))

    total = (await db.execute(count_stmt)).scalar() or 0
    items_stmt = base.order_by(Communication.comm_time.desc().nullslast()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(items_stmt)).scalars().all()

    # 将 key_info 中的 field_xxx key 翻译为中文 label
    from app.services.etl.enricher import translate_key_info_batch
    await translate_key_info_batch(rows, db)

    return CommunicationListResponse(
        items=[CommunicationOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{comm_id}", response_model=CommunicationOut, summary="沟通记录详情")
async def get_communication(
    request: Request,
    comm_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CommunicationOut:
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    stmt = select(Communication).where(Communication.id == comm_id)
    stmt = _apply_visibility(stmt, visible_ids)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="沟通记录不存在或无权访问")
    return CommunicationOut.model_validate(row)


@router.delete("/{comm_id}", summary="删除沟通记录")
async def delete_communication(
    comm_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """删除用户自己的沟通记录（仅限 owner 或 admin）。"""
    stmt = select(Communication).where(Communication.id == comm_id)
    if current_user.role != "admin":
        stmt = stmt.where(Communication.owner_id == current_user.feishu_open_id)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="沟通记录不存在或无权删除")

    await db.delete(row)
    await db.commit()
    return {"message": "已删除"}


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/batch-delete", summary="批量删除沟通记录")
async def batch_delete_communications(
    body: BatchDeleteRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """批量删除沟通记录（仅限 owner 或 admin）。"""
    stmt = select(Communication).where(Communication.id.in_(body.ids))
    if current_user.role != "admin":
        stmt = stmt.where(Communication.owner_id == current_user.feishu_open_id)
    rows = (await db.execute(stmt)).scalars().all()

    for row in rows:
        await db.delete(row)

    await db.commit()
    return {"deleted": len(rows)}
