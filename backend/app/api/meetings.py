"""会议管理接口。"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.meeting import Meeting
from app.models.tag import ContentTag
from app.models.user import User
from app.schemas.meeting import MeetingListResponse, MeetingOut

router = APIRouter(prefix="/api/meetings", tags=["会议"])


def _apply_visibility(stmt, visible_ids: list[str] | None):
    if visible_ids is not None:
        stmt = stmt.where(Meeting.owner_id.in_(visible_ids))
    return stmt


@router.get("/list", response_model=MeetingListResponse, summary="会议列表")
async def list_meetings(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    organizer: str | None = Query(None),
    tag_ids: list[int] = Query(default=[]),
) -> MeetingListResponse:
    visible_ids = await get_visible_owner_ids(current_user, db)

    base = select(Meeting)
    count_stmt = select(func.count()).select_from(Meeting)

    base = _apply_visibility(base, visible_ids)
    count_stmt = _apply_visibility(count_stmt, visible_ids)

    if search:
        like = f"%{search}%"
        f = Meeting.title.ilike(like) | Meeting.content_text.ilike(like)
        base = base.where(f)
        count_stmt = count_stmt.where(f)

    if start_date:
        base = base.where(Meeting.meeting_time >= start_date)
        count_stmt = count_stmt.where(Meeting.meeting_time >= start_date)

    if end_date:
        base = base.where(Meeting.meeting_time <= end_date)
        count_stmt = count_stmt.where(Meeting.meeting_time <= end_date)

    if organizer:
        like = f"%{organizer}%"
        base = base.where(Meeting.organizer.ilike(like))
        count_stmt = count_stmt.where(Meeting.organizer.ilike(like))

    if tag_ids:
        subq = select(ContentTag.content_id).where(
            ContentTag.content_type == "meeting",
            ContentTag.tag_id.in_(tag_ids),
        )
        base = base.where(Meeting.id.in_(subq))
        count_stmt = count_stmt.where(Meeting.id.in_(subq))

    total = (await db.execute(count_stmt)).scalar() or 0
    items_stmt = base.order_by(Meeting.meeting_time.desc().nullslast()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(items_stmt)).scalars().all()

    return MeetingListResponse(
        items=[MeetingOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{meeting_id}", response_model=MeetingOut, summary="会议详情")
async def get_meeting(
    meeting_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MeetingOut:
    visible_ids = await get_visible_owner_ids(current_user, db)

    stmt = select(Meeting).where(Meeting.id == meeting_id)
    stmt = _apply_visibility(stmt, visible_ids)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会议不存在或无权访问")
    return MeetingOut.model_validate(row)


@router.delete("/{meeting_id}", summary="删除会议")
async def delete_meeting(
    meeting_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """删除用户自己同步的会议记录（仅限 owner 或 admin）。"""
    stmt = select(Meeting).where(Meeting.id == meeting_id)
    if current_user.role != "admin":
        stmt = stmt.where(Meeting.owner_id == current_user.feishu_open_id)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="会议不存在或无权删除")

    await db.delete(row)
    await db.commit()
    return {"message": "已删除"}


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/batch-delete", summary="批量删除会议")
async def batch_delete_meetings(
    body: BatchDeleteRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """批量删除会议记录（仅限 owner 或 admin）。"""
    stmt = select(Meeting).where(Meeting.id.in_(body.ids))
    if current_user.role != "admin":
        stmt = stmt.where(Meeting.owner_id == current_user.feishu_open_id)
    rows = (await db.execute(stmt)).scalars().all()

    for row in rows:
        await db.delete(row)

    await db.commit()
    return {"deleted": len(rows)}
