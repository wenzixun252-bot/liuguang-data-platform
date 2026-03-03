"""对话会话 CRUD + 导出 + 推送飞书。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db
from app.models.conversation import Conversation, ConversationMessage
from app.models.user import User
from app.schemas.conversation import (
    ConversationCreate,
    ConversationDetailOut,
    ConversationOut,
    ConversationUpdate,
)
from app.services.feishu import feishu_client, FeishuAPIError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversations", tags=["对话会话"])


async def _get_conversation(conv_id: int, owner_id: str, db: AsyncSession) -> Conversation:
    result = await db.execute(
        select(Conversation).where(Conversation.id == conv_id, Conversation.owner_id == owner_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conv


@router.get("", response_model=list[ConversationOut], summary="会话列表")
async def list_conversations(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.owner_id == current_user.feishu_open_id)
        .order_by(Conversation.updated_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ConversationOut, summary="新建会话")
async def create_conversation(
    body: ConversationCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conv = Conversation(
        owner_id=current_user.feishu_open_id,
        title=body.title,
        scene=body.scene,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@router.get("/{conv_id}", response_model=ConversationDetailOut, summary="会话详情")
async def get_conversation(
    conv_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conv_id, Conversation.owner_id == current_user.feishu_open_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conv


@router.put("/{conv_id}", response_model=ConversationOut, summary="更新会话标题")
async def update_conversation(
    conv_id: int,
    body: ConversationUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conv = await _get_conversation(conv_id, current_user.feishu_open_id, db)
    conv.title = body.title
    await db.commit()
    await db.refresh(conv)
    return conv


@router.delete("/{conv_id}", summary="删除会话")
async def delete_conversation(
    conv_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conv = await _get_conversation(conv_id, current_user.feishu_open_id, db)
    await db.delete(conv)
    await db.commit()
    return {"detail": "已删除"}


@router.get("/{conv_id}/export", summary="导出 Markdown")
async def export_conversation(
    conv_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conv_id, Conversation.owner_id == current_user.feishu_open_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")

    lines = [f"# {conv.title}\n"]
    for msg in conv.messages:
        role_label = "用户" if msg.role == "user" else "流光助手"
        lines.append(f"### {role_label}\n")
        lines.append(f"{msg.content}\n")
    markdown = "\n".join(lines)
    return {"markdown": markdown, "title": conv.title}


@router.post("/{conv_id}/push-feishu", summary="推送到飞书文档")
async def push_to_feishu(
    conv_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conv_id, Conversation.owner_id == current_user.feishu_open_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 构建 Markdown 内容
    lines = [f"# {conv.title}\n"]
    for msg in conv.messages:
        role_label = "用户" if msg.role == "user" else "流光助手"
        lines.append(f"### {role_label}\n")
        lines.append(f"{msg.content}\n")
    markdown = "\n".join(lines)

    try:
        doc_result = await feishu_client.create_document(
            title=f"对话记录: {conv.title}",
            content=markdown,
            user_access_token=current_user.feishu_access_token,
            user_open_id=current_user.feishu_open_id,
        )
        return {"detail": "已推送到飞书", **doc_result}
    except FeishuAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
