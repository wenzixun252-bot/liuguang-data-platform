"""标签管理 API。"""

import logging
from typing import Annotated

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.tag import ContentTag, TagDefinition
from app.models.user import User
from app.schemas.tag import (
    BatchTagRequest,
    ContentTagCreate,
    ContentTagOut,
    DetachRequest,
    TagDefinitionCreate,
    TagDefinitionOut,
    TagDefinitionUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tags", tags=["标签管理"])


@router.get("", response_model=list[TagDefinitionOut], summary="查看所有可见标签")
async def list_tags(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TagDefinitionOut]:
    """返回当前用户能看到的标签：自己的 + 共享的 + 系统级（owner_id IS NULL）。"""
    owner_id = current_user.feishu_open_id
    result = await db.execute(
        select(TagDefinition).where(
            (TagDefinition.owner_id == owner_id)
            | (TagDefinition.is_shared == True)  # noqa: E712
            | (TagDefinition.owner_id.is_(None))
        ).order_by(TagDefinition.id)
    )
    return [TagDefinitionOut.model_validate(t) for t in result.scalars().all()]


@router.post("", response_model=TagDefinitionOut, summary="创建标签")
async def create_tag(
    body: TagDefinitionCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TagDefinitionOut:
    tag = TagDefinition(
        owner_id=current_user.feishu_open_id,
        category=body.category,
        name=body.name,
        color=body.color,
        is_shared=body.is_shared,
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return TagDefinitionOut.model_validate(tag)


@router.put("/{tag_id}", response_model=TagDefinitionOut, summary="修改标签")
async def update_tag(
    tag_id: int,
    body: TagDefinitionUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TagDefinitionOut:
    tag = await db.get(TagDefinition, tag_id)
    if not tag or (tag.owner_id and tag.owner_id != current_user.feishu_open_id):
        raise HTTPException(404, "标签不存在或无权修改")
    if body.name is not None:
        tag.name = body.name
    if body.color is not None:
        tag.color = body.color
    if body.is_shared is not None:
        tag.is_shared = body.is_shared
    await db.commit()
    await db.refresh(tag)
    return TagDefinitionOut.model_validate(tag)


@router.delete("/{tag_id}", summary="删除标签")
async def delete_tag(
    tag_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    tag = await db.get(TagDefinition, tag_id)
    if not tag or (tag.owner_id and tag.owner_id != current_user.feishu_open_id):
        raise HTTPException(404, "标签不存在或无权删除")
    await db.delete(tag)
    await db.commit()
    return {"message": "已删除"}


@router.post("/attach", response_model=ContentTagOut, summary="给内容打标签")
async def attach_tag(
    body: ContentTagCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ContentTagOut:
    tag = await db.get(TagDefinition, body.tag_id)
    if not tag:
        raise HTTPException(404, "标签不存在")

    # 检查是否已存在
    existing = await db.execute(
        select(ContentTag).where(
            ContentTag.tag_id == body.tag_id,
            ContentTag.content_type == body.content_type,
            ContentTag.content_id == body.content_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "该标签已存在于此内容上")

    ct = ContentTag(
        tag_id=body.tag_id,
        content_type=body.content_type,
        content_id=body.content_id,
        tagged_by="user_manual",
    )
    db.add(ct)
    await db.commit()
    await db.refresh(ct)
    return ContentTagOut(
        id=ct.id,
        tag_id=ct.tag_id,
        tag_name=tag.name,
        tag_color=tag.color,
        content_type=ct.content_type,
        content_id=ct.content_id,
        tagged_by=ct.tagged_by,
        confidence=ct.confidence,
    )


@router.post("/batch-attach", summary="批量打标签")
async def batch_attach_tags(
    body: BatchTagRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    count = 0
    for tag_id in body.tag_ids:
        for content_id in body.content_ids:
            existing = await db.execute(
                select(ContentTag).where(
                    ContentTag.tag_id == tag_id,
                    ContentTag.content_type == body.content_type,
                    ContentTag.content_id == content_id,
                )
            )
            if not existing.scalar_one_or_none():
                db.add(ContentTag(
                    tag_id=tag_id,
                    content_type=body.content_type,
                    content_id=content_id,
                    tagged_by="user_manual",
                ))
                count += 1
    await db.commit()
    return {"attached": count}


@router.post("/batch-detach", summary="批量移除标签")
async def batch_detach_tags(
    body: BatchTagRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    result = await db.execute(
        delete(ContentTag).where(
            ContentTag.tag_id.in_(body.tag_ids),
            ContentTag.content_type == body.content_type,
            ContentTag.content_id.in_(body.content_ids),
        )
    )
    await db.commit()
    return {"detached": result.rowcount}


@router.delete("/detach", summary="取消标签")
async def detach_tag(
    body: DetachRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    await db.execute(
        delete(ContentTag).where(
            ContentTag.tag_id == body.tag_id,
            ContentTag.content_type == body.content_type,
            ContentTag.content_id == body.content_id,
        )
    )
    await db.commit()
    return {"message": "已取消"}


@router.get(
    "/content/{content_type}/{content_id}",
    response_model=list[ContentTagOut],
    summary="查询内容的标签",
)
async def get_content_tags(
    content_type: str,
    content_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ContentTagOut]:
    result = await db.execute(
        select(ContentTag, TagDefinition.name, TagDefinition.color)
        .join(TagDefinition, ContentTag.tag_id == TagDefinition.id)
        .where(
            ContentTag.content_type == content_type,
            ContentTag.content_id == content_id,
        )
    )
    items = []
    for ct, tag_name, tag_color in result.all():
        items.append(ContentTagOut(
            id=ct.id,
            tag_id=ct.tag_id,
            tag_name=tag_name,
            tag_color=tag_color,
            content_type=ct.content_type,
            content_id=ct.content_id,
            tagged_by=ct.tagged_by,
            confidence=ct.confidence,
        ))
    return items


@router.get("/content-batch", summary="批量查询多条内容的标签")
async def get_content_tags_batch(
    content_type: str = Query(...),
    content_ids: list[int] = Query(...),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
) -> dict[int, list[ContentTagOut]]:
    """一次性查询多条内容的标签，返回 {content_id: [标签列表]} 的映射。"""
    if not content_ids:
        return {}
    result = await db.execute(
        select(ContentTag, TagDefinition.name, TagDefinition.color)
        .join(TagDefinition, ContentTag.tag_id == TagDefinition.id)
        .where(
            ContentTag.content_type == content_type,
            ContentTag.content_id.in_(content_ids),
        )
    )
    mapping: dict[int, list[ContentTagOut]] = defaultdict(list)
    for ct, tag_name, tag_color in result.all():
        mapping[ct.content_id].append(ContentTagOut(
            id=ct.id,
            tag_id=ct.tag_id,
            tag_name=tag_name,
            tag_color=tag_color,
            content_type=ct.content_type,
            content_id=ct.content_id,
            tagged_by=ct.tagged_by,
            confidence=ct.confidence,
        ))
    return dict(mapping)
