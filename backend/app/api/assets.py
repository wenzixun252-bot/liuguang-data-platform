"""统一看板统计接口 — 从三张表聚合统计数据。"""

import math
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import cast, Date, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids

from app.models.asset import ETLDataSource, CloudFolderSource
from app.models.cleaning_rule import CleaningRule
from app.models.communication import Communication
from app.models.document import Document
from app.models.extraction_rule import ExtractionRule
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.structured_table import StructuredTable
from app.models.tag import ContentTag
from app.models.user import User
from app.schemas.asset import AssetScoreResponse, AssetStatsResponse, ScoreAction, ScoreDimension

router = APIRouter(prefix="/api/assets", tags=["统计"])


@router.get("/stats", response_model=AssetStatsResponse, summary="统一看板统计")
async def get_asset_stats(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetStatsResponse:
    """返回三张表的聚合统计数据。"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)

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
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetScoreResponse:
    """计算当前用户的数据资产归档评分（6个维度）。"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)

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

    # --- 2. Quality (内容质量指数 = 基础质量70% + 社群热度加分30%) ---
    quality_vals: list[float] = []
    for model in [Document, Communication, StructuredTable]:
        stmt = select(func.avg(model.quality_score)).select_from(model).where(model.quality_score.is_not(None))
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        avg_val = (await db.execute(stmt)).scalar()
        if avg_val is not None:
            quality_vals.append(float(avg_val))
    quality_base = int(sum(quality_vals) / len(quality_vals) * 70) if quality_vals else 0

    # 社群热度：我的文档被他人归档次数，作为内容质量加分项
    my_owner_id = current_user.feishu_open_id
    community_total = 0

    my_doc_frids_stmt = (
        select(distinct(Document.feishu_record_id))
        .where(
            Document.feishu_record_id.isnot(None),
            Document.extra_fields["_original_owner"]["id"].astext == my_owner_id,
        )
    )
    my_doc_frids = [r[0] for r in (await db.execute(my_doc_frids_stmt)).all()]

    if my_doc_frids:
        doc_others_stmt = (
            select(func.count())
            .select_from(Document)
            .where(
                Document.feishu_record_id.in_(my_doc_frids),
                Document.owner_id != my_owner_id,
            )
        )
        community_total += (await db.execute(doc_others_stmt)).scalar() or 0

    from sqlalchemy import tuple_
    my_st_keys_stmt = (
        select(StructuredTable.source_app_token, StructuredTable.source_table_id)
        .where(
            StructuredTable.source_app_token.isnot(None),
            StructuredTable.source_table_id.isnot(None),
            StructuredTable.extra_fields["_original_owner"]["id"].astext == my_owner_id,
        )
    )
    my_st_keys = list({(r[0], r[1]) for r in (await db.execute(my_st_keys_stmt)).all()})

    if my_st_keys:
        st_others_stmt = (
            select(func.count())
            .select_from(StructuredTable)
            .where(
                tuple_(StructuredTable.source_app_token, StructuredTable.source_table_id).in_(my_st_keys),
                StructuredTable.owner_id != my_owner_id,
            )
        )
        community_total += (await db.execute(st_others_stmt)).scalar() or 0

    community_bonus = min(30, int(_log_score(community_total, 50) * 0.3))
    quality_score = min(100, quality_base + community_bonus)

    # --- 3. Knowledge Graph (生成即80分，达到阈值给满分) ---
    entity_count = await _count(KGEntity)
    relation_count = await _count(KGRelation)
    kg_total = entity_count + relation_count
    if kg_total == 0:
        knowledge_score = 0
    else:
        knowledge_score = 80
        if entity_count >= 20 or relation_count >= 15:
            knowledge_score += 10
        if entity_count >= 50 or relation_count >= 30:
            knowledge_score += 10
    knowledge_score = min(100, knowledge_score)

    # --- 4. Tag Coverage (only count tags on user's own content) ---
    tagged_count = 0
    for ct, model in [("document", Document), ("communication", Communication), ("structured_table", StructuredTable)]:
        ct_stmt = (
            select(func.count(distinct(ContentTag.content_id)))
            .where(ContentTag.content_type == ct)
            .where(ContentTag.content_id.in_(
                select(model.id).where(model.owner_id.in_(visible_ids))
                if visible_ids is not None
                else select(model.id)
            ))
        )
        tagged_count += (await db.execute(ct_stmt)).scalar() or 0
    tags_score = _ratio_score(tagged_count, total_count) if total_count > 0 else 0

    # --- 5. Activity (last 30 days, log scale on absolute count) ---
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    recent_count = 0
    for model in [Document, Communication, StructuredTable]:
        recent_count += await _count(model, model.created_at >= thirty_days_ago)
    activity_score = _log_score(recent_count, 100)

    # --- 6. Source Activation (3 types: 会话记录, 会议记录, 云文件夹) ---
    source_types_total = 3
    active_types = 0
    source_labels: list[str] = []

    # 6a. 会话记录 — 判断 communications 表中是否有 chat 类型的记录
    chat_stmt = select(func.count()).select_from(Communication).where(
        Communication.owner_id.in_(visible_ids),
        Communication.comm_type == "chat",
    )
    has_chat = ((await db.execute(chat_stmt)).scalar() or 0) > 0
    if has_chat:
        active_types += 1
    source_labels.append(f"会话记录 {'✓' if has_chat else '✗'}")

    # 6b. 会议记录 — 判断 communications 表中是否有 meeting 类型的记录
    meeting_stmt = select(func.count()).select_from(Communication).where(
        Communication.owner_id.in_(visible_ids),
        Communication.comm_type == "meeting",
    )
    has_meeting = ((await db.execute(meeting_stmt)).scalar() or 0) > 0
    if has_meeting:
        active_types += 1
    source_labels.append(f"会议记录 {'✓' if has_meeting else '✗'}")

    # 6c. 云文件夹
    folder_stmt = select(func.count()).select_from(CloudFolderSource).where(
        CloudFolderSource.owner_id == current_user.feishu_open_id
    )
    has_folder = ((await db.execute(folder_stmt)).scalar() or 0) > 0
    if has_folder:
        active_types += 1
    source_labels.append(f"云文件夹 {'✓' if has_folder else '✗'}")

    sources_score = _ratio_score(active_types, source_types_total)
    sources_detail = " · ".join(source_labels)

    # --- 7. Data Rules (是否配置了数据提取规则和清洗规则) ---
    rules_total = 2  # 提取规则 + 清洗规则
    rules_active = 0

    extraction_stmt = select(func.count()).select_from(ExtractionRule).where(
        ExtractionRule.owner_id == current_user.feishu_open_id,
        ExtractionRule.is_active == True,
    )
    has_extraction = ((await db.execute(extraction_stmt)).scalar() or 0) > 0
    if has_extraction:
        rules_active += 1

    cleaning_stmt = select(func.count()).select_from(CleaningRule).where(
        CleaningRule.owner_id == current_user.feishu_open_id,
        CleaningRule.is_active == True,
    )
    has_cleaning = ((await db.execute(cleaning_stmt)).scalar() or 0) > 0
    if has_cleaning:
        rules_active += 1

    rules_score = _ratio_score(rules_active, rules_total)

    # --- Build dimensions ---
    avg_quality_val = sum(quality_vals) / len(quality_vals) if quality_vals else 0
    quality_detail = f"内容质量 {avg_quality_val:.2f} · 被引用 {community_total} 次" if quality_vals else "暂无数据"
    dims = [
        ("volume", "数据资产规模", volume_score, f"文档 {doc_count} 篇 · 沟通 {comm_count} 条 · 表格 {table_count} 张", "/data-import", "去导入数据"),
        ("quality", "内容质量指数", quality_score, quality_detail, None, None),
        ("knowledge", "知识图谱", knowledge_score, f"{entity_count} 个实体, {relation_count} 条关系", "__action:build_kg" if knowledge_score == 0 else None, "构建图谱" if knowledge_score == 0 else None),
        ("tags", "标签覆盖", tags_score, f"{tagged_count}/{total_count} 已标签", "/settings?tab=tags", "去管理标签"),
        ("activity", "活跃度", activity_score, f"近30天新增 {recent_count} 条", "/data-import", "去同步数据"),
        ("sources", "数据源激活", sources_score, sources_detail, "/data-import", "去开启同步"),
        ("rules", "数据治理规则", rules_score, f"提取规则 {'✓' if has_extraction else '✗'} · 清洗规则 {'✓' if has_cleaning else '✗'}", "/data-import?tab=rules", "去配置规则"),
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
