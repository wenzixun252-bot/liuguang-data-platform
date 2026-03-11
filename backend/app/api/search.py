"""全局聚合搜索 API — 结合知识图谱 + 统一内容搜索 + 标签过滤。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.communication import Communication
from app.models.document import Document
from app.models.knowledge_graph import KGEntity
from app.models.structured_table import StructuredTable, StructuredTableRow
from app.models.user import User
from app.services.unified_content import unified_search, get_tags_for_content

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["全局搜索"])


class TagInfo(BaseModel):
    tag_id: int
    name: str
    color: str


class SearchResultItem(BaseModel):
    """搜索结果条目。"""
    id: int
    title: str
    content_preview: str
    source_type: str  # document / communication / kg_entity / structured_table
    created_at: str | None = None
    entity_type: str | None = None
    mention_count: int | None = None
    tags: list[TagInfo] = []

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    """搜索响应。"""
    keyword: str
    entities: list[SearchResultItem]
    data_items: list[SearchResultItem]
    total: int


@router.get("", response_model=SearchResponse, summary="全局关键词搜索")
async def global_search(
    request: Request,
    q: str | None = Query(None, max_length=200, description="搜索关键词"),
    tag_ids: str | None = Query(None, description="标签ID，逗号分隔"),
    content_types: str | None = Query(None, description="内容类型，逗号分隔"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
) -> SearchResponse:
    """全局搜索：同时查询知识图谱实体 + 文档/沟通记录，支持标签过滤。"""
    owner_id = current_user.feishu_open_id
    keyword = (q or "").strip()
    entities: list[SearchResultItem] = []
    data_items: list[SearchResultItem] = []

    # 解析参数
    parsed_tag_ids = None
    if tag_ids:
        parsed_tag_ids = [int(t.strip()) for t in tag_ids.split(",") if t.strip().isdigit()]

    parsed_types = None
    if content_types:
        parsed_types = [t.strip() for t in content_types.split(",") if t.strip()]

    # 1. 搜索知识图谱实体（仅关键词搜索时）
    if keyword:
        kg_result = await db.execute(
            select(KGEntity)
            .where(and_(
                KGEntity.owner_id == owner_id,
                KGEntity.name.ilike(f"%{keyword}%"),
            ))
            .order_by(KGEntity.mention_count.desc())
            .limit(10)
        )
        for e in kg_result.scalars().all():
            entities.append(SearchResultItem(
                id=e.id,
                title=e.name,
                content_preview=f"{e.entity_type} · 出现 {e.mention_count} 次",
                source_type="kg_entity",
                entity_type=e.entity_type,
                mention_count=e.mention_count,
            ))

    # 2. 统一内容搜索（带标签过滤和权限）
    visible_ids = await get_visible_owner_ids(current_user, db, request)
    results = await unified_search(
        db=db,
        keyword=keyword or None,
        tag_ids=parsed_tag_ids,
        content_types=parsed_types,
        visible_ids=visible_ids,
        page=1,
        page_size=20,
    )

    # 3. 批量获取标签
    tag_map = await get_tags_for_content(db, results)

    for item in results:
        key = f"{item['content_type']}:{item['id']}"
        item_tags = [TagInfo(**t) for t in tag_map.get(key, [])]
        data_items.append(SearchResultItem(
            id=item["id"],
            title=item["title"] or "无标题",
            content_preview=(item["content_text"] or "")[:100],
            source_type=item["content_type"],
            created_at=item.get("created_at"),
            tags=item_tags,
        ))

    return SearchResponse(
        keyword=keyword,
        entities=entities,
        data_items=data_items,
        total=len(entities) + len(data_items),
    )
