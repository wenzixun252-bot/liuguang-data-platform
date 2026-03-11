"""员工画像聚合 API — 结合知识图谱 + 领导力洞察。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.leadership_insight import LeadershipInsight
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profile", tags=["员工画像"])


class RelatedEntityInfo(BaseModel):
    id: int
    name: str
    entity_type: str
    relation_type: str
    weight: int = 1

    model_config = {"from_attributes": True}


class ProfileResponse(BaseModel):
    """员工画像聚合响应。"""
    entity_id: int | None = None
    name: str
    entity_type: str = "person"
    mention_count: int = 0
    # 关联实体
    collaborators: list[RelatedEntityInfo] = []
    items: list[RelatedEntityInfo] = []
    # 领导力洞察
    leadership_insight: dict | None = None


@router.get("/by-entity/{entity_id}", response_model=ProfileResponse, summary="按实体ID获取员工画像")
async def get_profile_by_entity(
    entity_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProfileResponse:
    """获取知识图谱中某个 person 实体的画像，聚合其关联关系和领导力洞察。"""
    owner_id = current_user.feishu_open_id

    entity = await db.get(KGEntity, entity_id)
    if not entity or entity.owner_id != owner_id:
        from fastapi import HTTPException
        raise HTTPException(404, "实体不存在")

    return await _build_profile(entity, owner_id, db)


@router.get("/by-name", response_model=ProfileResponse | None, summary="按姓名获取员工画像")
async def get_profile_by_name(
    name: str = Query(..., min_length=1),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """按姓名搜索 person 实体并返回画像。"""
    owner_id = current_user.feishu_open_id

    result = await db.execute(
        select(KGEntity).where(and_(
            KGEntity.owner_id == owner_id,
            KGEntity.entity_type == "person",
            KGEntity.name.ilike(f"%{name}%"),
        ))
        .order_by(KGEntity.mention_count.desc())
        .limit(1)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        return None

    return await _build_profile(entity, owner_id, db)


async def _build_profile(entity: KGEntity, owner_id: str, db: AsyncSession) -> ProfileResponse:
    """构建完整的员工画像。"""
    # 获取所有关联关系
    rel_result = await db.execute(
        select(KGRelation).where(and_(
            KGRelation.owner_id == owner_id,
            or_(
                KGRelation.source_entity_id == entity.id,
                KGRelation.target_entity_id == entity.id,
            ),
        ))
    )
    relations = rel_result.scalars().all()

    # 收集关联实体ID
    related_ids = set()
    for r in relations:
        related_ids.add(r.source_entity_id)
        related_ids.add(r.target_entity_id)
    related_ids.discard(entity.id)

    # 批量查询关联实体
    related_map: dict[int, KGEntity] = {}
    if related_ids:
        re_result = await db.execute(
            select(KGEntity).where(KGEntity.id.in_(related_ids))
        )
        for e in re_result.scalars().all():
            related_map[e.id] = e

    # 分类整理: person -> collaborators, item -> items
    collaborators = []
    items = []

    for r in relations:
        other_id = r.target_entity_id if r.source_entity_id == entity.id else r.source_entity_id
        other = related_map.get(other_id)
        if not other:
            continue

        info = RelatedEntityInfo(
            id=other.id,
            name=other.name,
            entity_type=other.entity_type,
            relation_type=r.relation_type,
            weight=r.weight,
        )

        if other.entity_type == "person":
            collaborators.append(info)
        else:
            items.append(info)

    # 按权重排序
    collaborators.sort(key=lambda x: x.weight, reverse=True)
    items.sort(key=lambda x: x.weight, reverse=True)

    # 查找领导力洞察（按名字匹配）
    insight_result = await db.execute(
        select(LeadershipInsight)
        .where(LeadershipInsight.target_user_name == entity.name)
        .order_by(LeadershipInsight.generated_at.desc())
        .limit(1)
    )
    insight = insight_result.scalar_one_or_none()
    insight_data = None
    if insight:
        insight_data = {
            "id": insight.id,
            "report_markdown": insight.report_markdown,
            "dimensions": insight.dimensions,
            "data_coverage": insight.data_coverage,
            "generated_at": insight.generated_at.isoformat(),
        }

    return ProfileResponse(
        entity_id=entity.id,
        name=entity.name,
        entity_type=entity.entity_type,
        mention_count=entity.mention_count,
        collaborators=collaborators,
        items=items,
        leadership_insight=insight_data,
    )
