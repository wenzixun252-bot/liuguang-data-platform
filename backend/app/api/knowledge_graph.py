"""知识图谱 API 端点。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.user import User
from app.schemas.knowledge_graph import (
    KGEntityDetail,
    KGEntityOut,
    KGGraphResponse,
    KGRelationOut,
    KGSearchRequest,
    KGStatsResponse,
)
from app.services.kg_builder import build_knowledge_graph

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/knowledge-graph", tags=["知识图谱"])


@router.post("/build", summary="触发图谱构建/增量更新")
async def build_graph(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    incremental: bool = Query(True),
):
    """触发知识图谱构建或增量更新。"""
    result = await build_knowledge_graph(
        db=db,
        owner_id=current_user.feishu_open_id,
        incremental=incremental,
    )
    return result


@router.get("", response_model=KGGraphResponse, summary="获取图谱数据")
async def get_graph(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_type: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    """获取图谱数据（节点+边）。"""
    conditions = [KGEntity.owner_id == current_user.feishu_open_id]
    if entity_type:
        conditions.append(KGEntity.entity_type == entity_type)

    # 获取实体
    entity_result = await db.execute(
        select(KGEntity)
        .where(and_(*conditions))
        .order_by(KGEntity.mention_count.desc())
        .limit(limit)
    )
    nodes = entity_result.scalars().all()
    node_ids = {n.id for n in nodes}

    # 获取这些实体之间的关系
    edges = []
    if node_ids:
        rel_result = await db.execute(
            select(KGRelation).where(
                and_(
                    KGRelation.owner_id == current_user.feishu_open_id,
                    KGRelation.source_entity_id.in_(node_ids),
                    KGRelation.target_entity_id.in_(node_ids),
                )
            )
        )
        edges = rel_result.scalars().all()

    return KGGraphResponse(nodes=nodes, edges=edges)


@router.get("/entities", response_model=list[KGEntityOut], summary="实体列表")
async def list_entities(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """获取实体列表。"""
    conditions = [KGEntity.owner_id == current_user.feishu_open_id]
    if entity_type:
        conditions.append(KGEntity.entity_type == entity_type)

    result = await db.execute(
        select(KGEntity)
        .where(and_(*conditions))
        .order_by(KGEntity.mention_count.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()


@router.get("/entities/{entity_id}", response_model=KGEntityDetail, summary="实体详情")
async def get_entity(
    entity_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取实体详情+关联关系。"""
    entity = await db.get(KGEntity, entity_id)
    if not entity or entity.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="实体不存在")

    # 获取关联关系
    rel_result = await db.execute(
        select(KGRelation).where(
            and_(
                KGRelation.owner_id == current_user.feishu_open_id,
                or_(
                    KGRelation.source_entity_id == entity_id,
                    KGRelation.target_entity_id == entity_id,
                ),
            )
        )
    )
    relations = rel_result.scalars().all()

    # 获取关联实体
    related_ids = set()
    for r in relations:
        related_ids.add(r.source_entity_id)
        related_ids.add(r.target_entity_id)
    related_ids.discard(entity_id)

    related_entities = []
    if related_ids:
        re_result = await db.execute(
            select(KGEntity).where(KGEntity.id.in_(related_ids))
        )
        related_entities = re_result.scalars().all()

    return KGEntityDetail(
        entity=entity,
        relations=relations,
        related_entities=related_entities,
    )


@router.get("/stats", response_model=KGStatsResponse, summary="图谱统计")
async def get_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取图谱统计信息。"""
    owner_id = current_user.feishu_open_id

    entity_count = await db.execute(
        select(func.count()).select_from(KGEntity).where(KGEntity.owner_id == owner_id)
    )
    total_entities = entity_count.scalar() or 0

    rel_count = await db.execute(
        select(func.count()).select_from(KGRelation).where(KGRelation.owner_id == owner_id)
    )
    total_relations = rel_count.scalar() or 0

    type_counts_result = await db.execute(
        select(KGEntity.entity_type, func.count(KGEntity.id))
        .where(KGEntity.owner_id == owner_id)
        .group_by(KGEntity.entity_type)
    )
    entity_type_counts = dict(type_counts_result.all())

    return KGStatsResponse(
        total_entities=total_entities,
        total_relations=total_relations,
        entity_type_counts=entity_type_counts,
    )


@router.post("/search", response_model=list[KGEntityOut], summary="实体搜索")
async def search_entities(
    body: KGSearchRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """搜索实体。"""
    conditions = [
        KGEntity.owner_id == current_user.feishu_open_id,
        KGEntity.name.ilike(f"%{body.query}%"),
    ]
    if body.entity_type:
        conditions.append(KGEntity.entity_type == body.entity_type)

    result = await db.execute(
        select(KGEntity)
        .where(and_(*conditions))
        .order_by(KGEntity.mention_count.desc())
        .limit(body.limit)
    )
    return result.scalars().all()
