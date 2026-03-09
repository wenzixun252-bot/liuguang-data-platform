"""知识图谱 API 端点。"""

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.content_entity_link import ContentEntityLink
from app.models.communication import Communication
from app.models.document import Document
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.kg_analysis_result import KGAnalysisResult
from app.models.user import User
from app.schemas.knowledge_graph import (
    AnalysisResponse,
    CommunityInfo,
    InsightItem,
    KGEntityDetail,
    KGEntityOut,
    KGGraphResponse,
    KGRelationOut,
    KGSearchRequest,
    KGStatsResponse,
    LinkedAsset,
)
from app.services.kg_builder import build_knowledge_graph
from app.services.kg_analyzer import run_full_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/knowledge-graph", tags=["知识图谱"])


async def _get_latest_analysis(db: AsyncSession, owner_id: str) -> KGAnalysisResult | None:
    """查询最新一条分析结果。"""
    result = await db.execute(
        select(KGAnalysisResult)
        .where(KGAnalysisResult.owner_id == owner_id)
        .order_by(KGAnalysisResult.generated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _save_analysis(db: AsyncSession, owner_id: str, analysis_result: dict) -> KGAnalysisResult:
    """将分析结果写入数据库。"""
    record = KGAnalysisResult(
        owner_id=owner_id,
        communities=analysis_result.get("communities", []),
        insights=analysis_result.get("insights", []),
        risks=analysis_result.get("risks", []),
        generated_at=datetime.utcnow(),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.post("/build-and-analyze", summary="构建图谱并运行分析")
@router.post("/auto-build", summary="构建图谱并运行分析（兼容旧路由）", include_in_schema=False)
async def build_and_analyze_graph(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """构建知识图谱并运行分析，结果持久化到数据库。"""
    owner_id = current_user.feishu_open_id

    # 检查现有实体数量，决定增量/全量
    entity_count = await db.execute(
        select(func.count()).select_from(KGEntity).where(KGEntity.owner_id == owner_id)
    )
    total_entities = entity_count.scalar() or 0
    incremental = total_entities > 0

    # 构建图谱
    build_result = await build_knowledge_graph(
        db=db,
        owner_id=owner_id,
        incremental=incremental,
    )

    # 构建完成后自动运行分析
    analysis_result = await run_full_analysis(db, owner_id)
    await _save_analysis(db, owner_id, analysis_result)

    return {
        "build": build_result,
        "analysis": analysis_result,
        "mode": "incremental" if incremental else "full",
    }


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


@router.post("/analyze", response_model=AnalysisResponse, summary="运行图谱分析")
async def analyze_graph(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """运行完整分析：社群检测 + 指标计算 + 风险检测 + LLM 总结。"""
    result = await run_full_analysis(db, current_user.feishu_open_id)
    await _save_analysis(db, current_user.feishu_open_id, result)
    return AnalysisResponse(**result)


@router.get("/communities", response_model=list[CommunityInfo], summary="社群列表")
async def get_communities(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取最近一次分析的社群列表。"""
    record = await _get_latest_analysis(db, current_user.feishu_open_id)
    if not record:
        return []
    return [CommunityInfo(**c) for c in record.communities]


@router.get("/insights", response_model=list[InsightItem], summary="洞察结果")
async def get_insights(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取最近一次分析的洞察结果。"""
    record = await _get_latest_analysis(db, current_user.feishu_open_id)
    if not record:
        return []
    return [InsightItem(**i) for i in record.insights]


@router.get("/risks", response_model=list[InsightItem], summary="风险预警")
async def get_risks(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取最近一次分析的风险预警。"""
    record = await _get_latest_analysis(db, current_user.feishu_open_id)
    if not record:
        return []
    return [InsightItem(**r) for r in record.risks]


@router.get("", response_model=KGGraphResponse, summary="获取图谱数据")
async def get_graph(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_type: str | None = Query(None),
    community_id: int | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    """获取图谱数据（节点+边+社群）。"""
    conditions = [KGEntity.owner_id == current_user.feishu_open_id]
    if entity_type:
        conditions.append(KGEntity.entity_type == entity_type)
    if community_id is not None:
        conditions.append(KGEntity.community_id == community_id)

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

    # 从数据库获取社群信息
    record = await _get_latest_analysis(db, current_user.feishu_open_id)
    communities = [CommunityInfo(**c) for c in record.communities] if record else []

    return KGGraphResponse(nodes=nodes, edges=edges, communities=communities)


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


@router.get("/entities/{entity_id}/linked-assets", response_model=list[LinkedAsset], summary="实体关联资产")
async def get_linked_assets(
    entity_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取实体关联的文档资产（按实体名称模糊匹配 documents 表）。"""
    entity = await db.get(KGEntity, entity_id)
    if not entity or entity.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="实体不存在")

    owner_id = current_user.feishu_open_id
    assets: list[LinkedAsset] = []

    # 在 documents 表模糊匹配
    doc_result = await db.execute(
        select(Document.id, Document.title, Document.source_type)
        .where(
            and_(
                Document.owner_id == owner_id,
                or_(
                    Document.title.ilike(f"%{entity.name}%"),
                    Document.content_text.ilike(f"%{entity.name}%"),
                ),
            )
        )
        .limit(10)
    )
    for r in doc_result.all():
        assets.append(LinkedAsset(id=r.id, title=r.title or "无标题", source_type=r.source_type, asset_type="document"))

    # 在 communications 表模糊匹配
    comm_result = await db.execute(
        select(Communication.id, Communication.title, Communication.comm_type)
        .where(
            and_(
                Communication.owner_id == owner_id,
                or_(
                    Communication.title.ilike(f"%{entity.name}%"),
                    Communication.content_text.ilike(f"%{entity.name}%"),
                ),
            )
        )
        .limit(10)
    )
    for r in comm_result.all():
        assets.append(LinkedAsset(id=r.id, title=r.title or "无标题", source_type=r.comm_type or "communication", asset_type="communication"))

    return assets


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

    # 查询最近分析时间
    record = await _get_latest_analysis(db, owner_id)
    last_analysis_at = record.generated_at if record else None

    return KGStatsResponse(
        total_entities=total_entities,
        total_relations=total_relations,
        entity_type_counts=entity_type_counts,
        last_analysis_at=last_analysis_at,
    )


@router.get("/content/{content_type}/{content_id}/entities", summary="内容关联的实体")
async def get_content_entities(
    content_type: str,
    content_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """通过内容-实体锚定表查询某条内容关联的所有实体。"""
    result = await db.execute(
        select(KGEntity, ContentEntityLink.relation_type, ContentEntityLink.context_snippet)
        .join(ContentEntityLink, ContentEntityLink.entity_id == KGEntity.id)
        .where(
            and_(
                ContentEntityLink.content_type == content_type,
                ContentEntityLink.content_id == content_id,
                KGEntity.owner_id == current_user.feishu_open_id,
            )
        )
    )
    items = []
    for entity, rel_type, snippet in result.all():
        items.append({
            "entity": KGEntityOut.model_validate(entity),
            "relation_type": rel_type,
            "context_snippet": snippet,
        })
    return items


@router.get("/entity/{entity_id}/content", summary="实体关联的内容")
async def get_entity_content(
    entity_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """通过内容-实体锚定表查询某实体关联的所有内容。"""
    entity = await db.get(KGEntity, entity_id)
    if not entity or entity.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="实体不存在")

    result = await db.execute(
        select(ContentEntityLink).where(ContentEntityLink.entity_id == entity_id)
    )
    links = result.scalars().all()

    items = []
    for link in links:
        title = ""
        if link.content_type == "document":
            doc = await db.get(Document, link.content_id)
            title = doc.title if doc else "无标题"
        elif link.content_type == "communication":
            comm = await db.get(Communication, link.content_id)
            title = (comm.title or comm.initiator or "沟通记录") if comm else "沟通记录"

        items.append({
            "content_type": link.content_type,
            "content_id": link.content_id,
            "title": title,
            "relation_type": link.relation_type,
            "context_snippet": link.context_snippet,
        })
    return items


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
