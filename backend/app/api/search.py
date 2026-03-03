"""全局聚合搜索 API — 结合知识图谱 + 数据表关键词搜索。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.document import Document
from app.models.meeting import Meeting
from app.models.chat_message import ChatMessage
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.structured_table import StructuredTable, StructuredTableRow
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["全局搜索"])


class SearchResultItem(BaseModel):
    """搜索结果条目。"""
    id: int
    title: str
    content_preview: str
    source_type: str  # document / meeting / chat_message / kg_entity
    created_at: str | None = None
    entity_type: str | None = None  # 知识图谱专用
    mention_count: int | None = None

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    """搜索响应。"""
    keyword: str
    entities: list[SearchResultItem]
    data_items: list[SearchResultItem]
    total: int


@router.get("", response_model=SearchResponse, summary="全局关键词搜索")
async def global_search(
    q: str = Query(..., min_length=1, max_length=200, description="搜索关键词"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
) -> SearchResponse:
    """全局搜索：同时查询知识图谱实体 + 文档/会议/聊天记录。"""
    owner_id = current_user.feishu_open_id
    keyword = q.strip()
    entities: list[SearchResultItem] = []
    data_items: list[SearchResultItem] = []

    # 1. 搜索知识图谱实体
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

    # 2. 搜索文档
    doc_result = await db.execute(
        select(Document)
        .where(and_(
            Document.owner_id == owner_id,
            or_(
                Document.title.ilike(f"%{keyword}%"),
                Document.content_text.ilike(f"%{keyword}%"),
            ),
        ))
        .order_by(Document.created_at.desc())
        .limit(5)
    )
    for d in doc_result.scalars().all():
        data_items.append(SearchResultItem(
            id=d.id,
            title=d.title or "无标题",
            content_preview=(d.content_text or "")[:100],
            source_type="document",
            created_at=d.created_at.isoformat() if d.created_at else None,
        ))

    # 3. 搜索会议
    meeting_result = await db.execute(
        select(Meeting)
        .where(and_(
            Meeting.owner_id == owner_id,
            or_(
                Meeting.title.ilike(f"%{keyword}%"),
                Meeting.content_text.ilike(f"%{keyword}%"),
            ),
        ))
        .order_by(Meeting.created_at.desc())
        .limit(5)
    )
    for m in meeting_result.scalars().all():
        data_items.append(SearchResultItem(
            id=m.id,
            title=m.title or "无标题",
            content_preview=(m.content_text or "")[:100],
            source_type="meeting",
            created_at=m.created_at.isoformat() if m.created_at else None,
        ))

    # 4. 搜索聊天记录
    chat_result = await db.execute(
        select(ChatMessage)
        .where(and_(
            ChatMessage.owner_id == owner_id,
            ChatMessage.content_text.ilike(f"%{keyword}%"),
        ))
        .order_by(ChatMessage.created_at.desc())
        .limit(5)
    )
    for c in chat_result.scalars().all():
        data_items.append(SearchResultItem(
            id=c.id,
            title=getattr(c, 'sender', None) or "聊天记录",
            content_preview=(c.content_text or "")[:100],
            source_type="chat_message",
            created_at=c.created_at.isoformat() if c.created_at else None,
        ))

    # 5. 搜索结构化数据表行
    st_result = await db.execute(
        select(StructuredTableRow, StructuredTable.name)
        .join(StructuredTable, StructuredTableRow.table_id == StructuredTable.id)
        .where(and_(
            StructuredTable.owner_id == owner_id,
            StructuredTableRow.row_text.ilike(f"%{keyword}%"),
        ))
        .order_by(StructuredTableRow.id.desc())
        .limit(5)
    )
    for row_obj, table_name in st_result.all():
        preview_parts = []
        for k, v in (row_obj.row_data or {}).items():
            if v:
                preview_parts.append(f"{k}: {v}")
        data_items.append(SearchResultItem(
            id=row_obj.id,
            title=table_name or "数据表",
            content_preview=" | ".join(preview_parts)[:100],
            source_type="structured_table",
            created_at=row_obj.created_at.isoformat() if row_obj.created_at else None,
        ))

    return SearchResponse(
        keyword=keyword,
        entities=entities,
        data_items=data_items,
        total=len(entities) + len(data_items),
    )
