"""聊天消息管理接口。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.chat_message import ChatMessage
from app.models.user import User
from app.schemas.chat_message import ChatMessageListResponse, ChatMessageOut

router = APIRouter(prefix="/api/chat-messages", tags=["聊天记录"])


def _apply_visibility(stmt, visible_ids: list[str] | None):
    if visible_ids is not None:
        stmt = stmt.where(ChatMessage.owner_id.in_(visible_ids))
    return stmt


@router.get("/list", response_model=ChatMessageListResponse, summary="聊天消息列表")
async def list_chat_messages(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    chat_id: str | None = Query(None),
) -> ChatMessageListResponse:
    visible_ids = await get_visible_owner_ids(current_user, db)

    base = select(ChatMessage)
    count_stmt = select(func.count()).select_from(ChatMessage)

    base = _apply_visibility(base, visible_ids)
    count_stmt = _apply_visibility(count_stmt, visible_ids)

    if search:
        like = f"%{search}%"
        f = ChatMessage.content_text.ilike(like)
        base = base.where(f)
        count_stmt = count_stmt.where(f)

    if chat_id:
        base = base.where(ChatMessage.chat_id == chat_id)
        count_stmt = count_stmt.where(ChatMessage.chat_id == chat_id)

    total = (await db.execute(count_stmt)).scalar() or 0
    items_stmt = base.order_by(ChatMessage.sent_at.desc().nullslast()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(items_stmt)).scalars().all()

    return ChatMessageListResponse(
        items=[ChatMessageOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{msg_id}", response_model=ChatMessageOut, summary="聊天消息详情")
async def get_chat_message(
    msg_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ChatMessageOut:
    visible_ids = await get_visible_owner_ids(current_user, db)

    stmt = select(ChatMessage).where(ChatMessage.id == msg_id)
    stmt = _apply_visibility(stmt, visible_ids)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在或无权访问")
    return ChatMessageOut.model_validate(row)


@router.delete("/{msg_id}", summary="删除聊天消息")
async def delete_chat_message(
    msg_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """删除用户自己同步的聊天消息（仅限 owner 或 admin）。"""
    stmt = select(ChatMessage).where(ChatMessage.id == msg_id)
    if current_user.role != "admin":
        stmt = stmt.where(ChatMessage.owner_id == current_user.feishu_open_id)
    row = (await db.execute(stmt)).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="消息不存在或无权删除")

    await db.delete(row)
    await db.commit()
    return {"message": "已删除"}
