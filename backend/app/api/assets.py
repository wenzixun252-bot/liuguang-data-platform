"""统一看板统计接口 — 从三张表聚合统计数据。"""

import math
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import cast, Date, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.asset import CloudFolderSource, ETLDataSource
from app.models.communication import Communication
from app.models.document import Document
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.structured_table import StructuredTable
from app.models.tag import ContentTag
from app.models.user import User
from app.schemas.asset import AssetScoreResponse, AssetStatsResponse, ScoreAction, ScoreDimension

router = APIRouter(prefix="/api/assets", tags=["统计"])


@router.get("/stats", response_model=AssetStatsResponse, summary="统一看板统计")
async def get_asset_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetStatsResponse:
    """返回三张表的聚合统计数据。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

    async def _count(model, extra_filter=None) -> int:
        stmt = select(func.count()).select_from(model)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra_filter is not None:
            stmt = stmt.where(extra_filter)
        return (await db.execute(stmt)).scalar() or 0

    async def _today_count(model, extra_filter=None) -> int:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = select(func.count()).select_from(model).where(model.created_at >= today_start)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra_filter is not None:
            stmt = stmt.where(extra_filter)
        return (await db.execute(stmt)).scalar() or 0

    doc_count = await _count(Document)
    comm_count = await _count(Communication)
    table_count = await _count(StructuredTable)

    total = doc_count + comm_count + table_count
    by_table = {
        "documents": doc_count,
        "communications": comm_count,
        "tables": table_count,
    }

    today_new = {
        "documents": await _today_count(Document),
        "communications": await _today_count(Communication),
        "tables": await _today_count(StructuredTable),
    }

    # 近30天趋势（基于 documents 表的 created_at）
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    trend_stmt = (
        select(
            cast(Document.created_at, Date).label("date"),
            func.count().label("count"),
        )
        .where(Document.created_at >= thirty_days_ago)
        .group_by(cast(Document.created_at, Date))
        .order_by(cast(Document.created_at, Date))
    )
    if visible_ids is not None:
        trend_stmt = trend_stmt.where(Document.owner_id.in_(visible_ids))

    trend_rows = (await db.execute(trend_stmt)).all()
    recent_trend = [{"date": str(row[0]), "count": row[1]} for row in trend_rows]

    return AssetStatsResponse(total=total, by_table=by_table, today_new=today_new, recent_trend=recent_trend)


# ---------------------------------------------------------------------------
# 个人数据资产评分
# ---------------------------------------------------------------------------

def _log_score(count: int, max_ref: int = 500) -> int:
    """Map a count to 0-100 using log curve. 0->0, max_ref->100."""
    if count <= 0:
        return 0
    return min(100, int(math.log(count + 1) / math.log(max_ref + 1) * 100))


def _ratio_score(numerator: int, denominator: int) -> int:
    """Map a ratio to 0-100."""
    if denominator <= 0:
        return 0
    return min(100, int(numerator / denominator * 100))


def _level(score: int) -> str:
    if score >= 90:
        return "卓越"
    if score >= 70:
        return "优秀"
    if score >= 50:
        return "良好"
    return "待提升"


@router.get("/score", response_model=AssetScoreResponse, summary="个人数据资产评分")
async def get_asset_score(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetScoreResponse:
    """计算当前用户的数据资产归档评分（7个维度）。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

    async def _count(model, extra_filter=None) -> int:
        stmt = select(func.count()).select_from(model)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra_filter is not None:
            stmt = stmt.where(extra_filter)
        return (await db.execute(stmt)).scalar() or 0

    # --- 1. Volume ---
    doc_count = await _count(Document)
    comm_count = await _count(Communication)
    table_count = await _count(StructuredTable)
    total_count = doc_count + comm_count + table_count
    volume_score = _log_score(total_count, 500)

    # --- 2. Quality ---
    quality_vals: list[float] = []
    for model in [Document, Communication, StructuredTable]:
        stmt = select(func.avg(model.quality_score)).select_from(model).where(model.quality_score.is_not(None))
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        avg_val = (await db.execute(stmt)).scalar()
        if avg_val is not None:
            quality_vals.append(float(avg_val))
    quality_score = int(sum(quality_vals) / len(quality_vals) * 100) if quality_vals else 0

    # --- 3. Knowledge Graph ---
    entity_count = await _count(KGEntity)
    relation_count = await _count(KGRelation)
    kg_total = entity_count + relation_count
    knowledge_score = _log_score(kg_total, 200)

    # --- 4. Tag Coverage ---
    tagged_stmt = select(func.count(distinct(ContentTag.content_id))).select_from(ContentTag)
    tagged_count = (await db.execute(tagged_stmt)).scalar() or 0
    tags_score = _ratio_score(tagged_count, total_count) if total_count > 0 else 0

    # --- 5. Activity (last 30 days) ---
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    recent_count = 0
    for model in [Document, Communication, StructuredTable]:
        recent_count += await _count(model, model.created_at >= thirty_days_ago)
    activity_ratio = recent_count / total_count if total_count > 0 else 0
    activity_score = min(100, int(activity_ratio / 0.3 * 100))

    # --- 6. Vectorization ---
    vectorized_count = 0
    for model in [Document, Communication, StructuredTable]:
        vectorized_count += await _count(model, model.content_vector.is_not(None))
    vectorization_score = _ratio_score(vectorized_count, total_count)

    # --- 7. Source Activation ---
    activated_types: set[str] = set()
    etl_stmt = select(distinct(ETLDataSource.asset_type)).where(ETLDataSource.is_enabled == True)  # noqa: E712
    if visible_ids is not None:
        etl_stmt = etl_stmt.where(
            (ETLDataSource.owner_id.in_(visible_ids)) | (ETLDataSource.owner_id.is_(None))
        )
    etl_types = (await db.execute(etl_stmt)).scalars().all()
    activated_types.update(etl_types)
    # CloudFolderSource counts as document source
    cf_stmt = select(func.count()).select_from(CloudFolderSource).where(CloudFolderSource.is_enabled == True)  # noqa: E712
    if visible_ids is not None:
        cf_stmt = cf_stmt.where(CloudFolderSource.owner_id.in_(visible_ids))
    if ((await db.execute(cf_stmt)).scalar() or 0) > 0:
        activated_types.add("document")
    active_count = len(activated_types.intersection({"document", "communication", "structured"}))
    sources_score = int(active_count / 3 * 100)

    # --- Build dimensions ---
    avg_quality_str = f"平均质量 {sum(quality_vals) / len(quality_vals):.2f}" if quality_vals else "暂无数据"
    dims = [
        ("volume", "数据量", volume_score, f"共 {total_count} 条数据资产", "/documents", "去导入数据"),
        ("quality", "数据质量", quality_score, avg_quality_str, None, None),
        ("knowledge", "知识图谱", knowledge_score, f"{entity_count} 个实体, {relation_count} 条关系", "__action:build_kg", "构建图谱"),
        ("tags", "标签覆盖", tags_score, f"{tagged_count}/{total_count} 已标签", "/settings", "去管理标签"),
        ("activity", "活跃度", activity_score, f"近30天新增 {recent_count} 条", "/documents", "去同步数据"),
        ("vectorization", "AI可搜索", vectorization_score, None, None, None),
        ("sources", "数据源激活", sources_score, f"已激活 {active_count}/3 类数据源", "/settings", "去开启同步"),
    ]

    dimensions: list[ScoreDimension] = []
    for key, label, score, detail, route, action_label in dims:
        action = None
        if score < 70 and route and action_label:
            action = ScoreAction(label=action_label, route=route)
        detail_str = detail or f"{score} 分"
        dimensions.append(ScoreDimension(key=key, label=label, score=score, detail=detail_str, action=action))

    all_scores = [d.score for d in dimensions]
    total_score = int(sum(all_scores) / len(all_scores))

    return AssetScoreResponse(total_score=total_score, level=_level(total_score), dimensions=dimensions)
