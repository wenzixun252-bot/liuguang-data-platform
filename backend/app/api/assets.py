"""统一看板统计接口 — 从三张表聚合统计数据。"""

import math
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import cast, Date, distinct, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids

from app.models.asset import ETLDataSource, CloudFolderSource
from app.models.communication import Communication
from app.models.document import Document
from app.models.structured_table import StructuredTable
from app.models.tag import ContentTag
from app.models.user import User
from app.schemas.asset import AssetScoreResponse, AssetStatsResponse, ScoreAction, ScoreDimension, SubScoreDetail

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


def _tier_score(value: float, tiers: list[tuple[float, float, int, int]]) -> int:
    """阶梯内线性插值。tiers: [(lower, upper, min_score, max_score), ...] 从高到低排列。"""
    for lower, upper, min_s, max_s in tiers:
        if value >= lower:
            if upper <= lower:
                return max_s
            ratio = min((value - lower) / (upper - lower), 1.0)
            return min_s + int(ratio * (max_s - min_s))
    return 0


# 参评的 Communication 类型（排除 chat）
SCORED_COMM_TYPES = ("meeting", "recording")

# ETL 质量均分阶梯 (子权重 0.4, 满分 40)
_QUALITY_AVG_TIERS: list[tuple[float, float, int, int]] = [
    (0.85, 1.0,  36, 40),
    (0.70, 0.85, 28, 36),
    (0.50, 0.70, 20, 28),
    (0.30, 0.50, 12, 20),
    (0.00, 0.30,  0, 12),
]

# 高质量内容占比阶梯 (子权重 0.35, 满分 35)
_HIGH_QUALITY_TIERS: list[tuple[float, float, int, int]] = [
    (0.70, 1.0,  30, 35),
    (0.50, 0.70, 22, 30),
    (0.30, 0.50, 15, 22),
    (0.10, 0.30,  8, 15),
    (0.00, 0.10,  0,  8),
]


@router.get("/score", response_model=AssetScoreResponse, summary="个人数据资产评分")
async def get_asset_score(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetScoreResponse:
    """计算当前用户的数据资产评分（5 个加权维度）。"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)
    my_owner_id = current_user.feishu_open_id

    # --- 通用计数辅助 ---
    async def _count(model, extra_filter=None) -> int:
        stmt = select(func.count()).select_from(model)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra_filter is not None:
            stmt = stmt.where(extra_filter)
        return (await db.execute(stmt)).scalar() or 0

    # --- 参评内容计数 ---
    doc_count = await _count(Document)
    table_count = await _count(StructuredTable)
    meeting_count = await _count(Communication, Communication.comm_type.in_(SCORED_COMM_TYPES))
    scored_total = doc_count + table_count + meeting_count

    # ═══ 维度 1: 内容质量 (权重 30%) ═══
    # 1a. ETL 质量均分
    quality_vals: list[float] = []
    for model, extra in [(Document, None), (StructuredTable, None),
                          (Communication, Communication.comm_type.in_(SCORED_COMM_TYPES))]:
        stmt = select(func.avg(model.quality_score)).select_from(model).where(model.quality_score.is_not(None))
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra is not None:
            stmt = stmt.where(extra)
        val = (await db.execute(stmt)).scalar()
        if val is not None:
            quality_vals.append(float(val))
    avg_quality = sum(quality_vals) / len(quality_vals) if quality_vals else 0.0
    quality_avg_score = _tier_score(avg_quality, _QUALITY_AVG_TIERS)

    # 1b. 高质量内容占比 (quality_score >= 0.7)
    high_quality_count = 0
    for model, extra in [(Document, None), (StructuredTable, None),
                          (Communication, Communication.comm_type.in_(SCORED_COMM_TYPES))]:
        stmt = select(func.count()).select_from(model).where(model.quality_score >= 0.7)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra is not None:
            stmt = stmt.where(extra)
        high_quality_count += (await db.execute(stmt)).scalar() or 0
    high_quality_ratio = high_quality_count / scored_total if scored_total > 0 else 0.0
    high_quality_score = _tier_score(high_quality_ratio, _HIGH_QUALITY_TIERS)

    # 1c. 字段完整率 (title/name + content_text 均非空)
    complete_count = 0
    for model, title_col, extra in [
        (Document, Document.title, None),
        (StructuredTable, StructuredTable.name, None),
        (Communication, Communication.title, Communication.comm_type.in_(SCORED_COMM_TYPES)),
    ]:
        stmt = select(func.count()).select_from(model).where(
            title_col.isnot(None), title_col != "",
            model.content_text.isnot(None), model.content_text != "",
        )
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra is not None:
            stmt = stmt.where(extra)
        complete_count += (await db.execute(stmt)).scalar() or 0
    completeness_ratio = complete_count / scored_total if scored_total > 0 else 0.0
    field_completeness_score = min(25, int(completeness_ratio * 25))

    dim_quality_score = quality_avg_score + high_quality_score + field_completeness_score
    dim_quality_detail = f"质量均分 {avg_quality:.2f} · 高质量占比 {high_quality_ratio:.0%} · 字段完整 {completeness_ratio:.0%}"

    # ═══ 维度 2: 数据完备度 (权重 20%) ═══
    # 2a. 数据量 (log curve, max_ref=1000, 子权重50%, 满分50)
    volume_sub = min(50, int(_log_score(scored_total, 1000) * 0.5))

    # 2b. 类型覆盖 (3 种类型, 子权重25%, 满分25)
    type_count = sum(1 for c in [doc_count, table_count, meeting_count] if c > 0)
    type_coverage_sub = {0: 0, 1: 10, 2: 18, 3: 25}[type_count]

    # 2c. 数据源数量 (ETLDataSource + CloudFolderSource, 子权重25%, 满分25)
    etl_src_count = (await db.execute(
        select(func.count()).select_from(ETLDataSource).where(ETLDataSource.owner_id == my_owner_id)
    )).scalar() or 0
    folder_src_count = (await db.execute(
        select(func.count()).select_from(CloudFolderSource).where(CloudFolderSource.owner_id == my_owner_id)
    )).scalar() or 0
    total_sources = etl_src_count + folder_src_count
    source_count_sub = min(25, int(_log_score(total_sources, 10) * 0.25))

    dim_completeness_score = volume_sub + type_coverage_sub + source_count_sub
    dim_completeness_detail = f"数据 {scored_total} 条 · {type_count}/3 类型 · {total_sources} 个数据源"

    # ═══ 维度 3: 标签规范度 (权重 20%) ═══
    # 3a. 标签覆盖率 (子权重40%, 满分40)
    tagged_count = 0
    for ct, model, extra in [
        ("document", Document, None),
        ("structured_table", StructuredTable, None),
        ("communication", Communication, Communication.comm_type.in_(SCORED_COMM_TYPES)),
    ]:
        sub_q = select(model.id)
        if visible_ids is not None:
            sub_q = sub_q.where(model.owner_id.in_(visible_ids))
        if extra is not None:
            sub_q = sub_q.where(extra)
        ct_stmt = (
            select(func.count(distinct(ContentTag.content_id)))
            .where(ContentTag.content_type == ct, ContentTag.content_id.in_(sub_q))
        )
        tagged_count += (await db.execute(ct_stmt)).scalar() or 0
    tag_coverage_ratio = tagged_count / scored_total if scored_total > 0 else 0.0
    tag_coverage_sub = min(40, int(tag_coverage_ratio * 40))

    # 3b. 标签多样性 + 3c. 标签深度
    all_tag_ids: set[int] = set()
    total_tag_assignments = 0
    for ct, model, extra in [
        ("document", Document, None),
        ("structured_table", StructuredTable, None),
        ("communication", Communication, Communication.comm_type.in_(SCORED_COMM_TYPES)),
    ]:
        sub_q = select(model.id)
        if visible_ids is not None:
            sub_q = sub_q.where(model.owner_id.in_(visible_ids))
        if extra is not None:
            sub_q = sub_q.where(extra)
        # distinct tags
        dt_rows = (await db.execute(
            select(distinct(ContentTag.tag_id)).where(ContentTag.content_type == ct, ContentTag.content_id.in_(sub_q))
        )).all()
        all_tag_ids.update(r[0] for r in dt_rows)
        # total assignments
        total_tag_assignments += (await db.execute(
            select(func.count()).select_from(ContentTag).where(ContentTag.content_type == ct, ContentTag.content_id.in_(sub_q))
        )).scalar() or 0

    distinct_tag_count = len(all_tag_ids)
    tag_diversity_sub = min(35, int(min(distinct_tag_count, 10) / 10 * 35))

    avg_tags_per_item = total_tag_assignments / tagged_count if tagged_count > 0 else 0.0
    tag_depth_sub = min(25, int(min(avg_tags_per_item, 3.0) / 3.0 * 25))

    dim_tags_score = tag_coverage_sub + tag_diversity_sub + tag_depth_sub
    dim_tags_detail = f"覆盖 {tag_coverage_ratio:.0%} · {distinct_tag_count} 种标签 · 均 {avg_tags_per_item:.1f} 个/条"

    # ═══ 维度 4: 数据时效性 (权重 15%) ═══
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)

    # 4a. 近期更新率 (子权重60%, 满分60)
    recent_count = 0
    for model, extra in [(Document, None), (StructuredTable, None),
                          (Communication, Communication.comm_type.in_(SCORED_COMM_TYPES))]:
        filt = model.created_at >= thirty_days_ago
        if extra is not None:
            filt = filt & extra
        recent_count += await _count(model, filt)
    freshness_ratio = recent_count / scored_total if scored_total > 0 else 0.0
    freshness_sub = min(60, int(freshness_ratio * 60))

    # 4b. 更新规律性 (近30天有多少天有新数据, 子权重40%, 满分40)
    active_days: set[str] = set()
    for model, extra in [(Document, None), (StructuredTable, None),
                          (Communication, Communication.comm_type.in_(SCORED_COMM_TYPES))]:
        stmt = select(distinct(cast(model.created_at, Date))).where(model.created_at >= thirty_days_ago)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        if extra is not None:
            stmt = stmt.where(extra)
        rows = (await db.execute(stmt)).all()
        active_days.update(str(r[0]) for r in rows if r[0] is not None)
    days_count = len(active_days)
    regularity_sub = min(40, int(days_count / 30 * 40))

    dim_freshness_score = freshness_sub + regularity_sub
    dim_freshness_detail = f"近30天新增 {recent_count} 条 · {days_count} 天活跃"

    # ═══ 维度 5: 数据影响力 (权重 15%) — 仅文档 + 表格 ═══
    # 5a. 被他人归档次数
    # 找出"我的文档"：owner_id 是我 或 _original_owner.id 是我（覆盖云文档和 ETL 导入两种场景）
    my_doc_frids_stmt = select(distinct(Document.feishu_record_id)).where(
        Document.feishu_record_id.isnot(None),
        or_(
            Document.owner_id == my_owner_id,
            Document.extra_fields["_original_owner"]["id"].astext == my_owner_id,
        ),
    )
    my_doc_frids = [r[0] for r in (await db.execute(my_doc_frids_stmt)).all()]

    doc_archive_count = 0
    doc_archive_users: set[str] = set()
    doc_referenced_frids: set[str] = set()
    if my_doc_frids:
        doc_others = (await db.execute(
            select(Document.owner_id, Document.feishu_record_id).where(
                Document.feishu_record_id.in_(my_doc_frids), Document.owner_id != my_owner_id,
            )
        )).all()
        doc_archive_count = len(doc_others)
        doc_archive_users.update(r[0] for r in doc_others)
        doc_referenced_frids.update(r[1] for r in doc_others)

    my_st_keys_stmt = select(StructuredTable.source_app_token, StructuredTable.source_table_id).where(
        StructuredTable.source_app_token.isnot(None), StructuredTable.source_table_id.isnot(None),
        or_(
            StructuredTable.owner_id == my_owner_id,
            StructuredTable.extra_fields["_original_owner"]["id"].astext == my_owner_id,
        ),
    )
    my_st_keys = list({(r[0], r[1]) for r in (await db.execute(my_st_keys_stmt)).all()})

    st_archive_count = 0
    st_archive_users: set[str] = set()
    st_referenced_keys: set[tuple] = set()
    if my_st_keys:
        st_others = (await db.execute(
            select(StructuredTable.owner_id, StructuredTable.source_app_token, StructuredTable.source_table_id).where(
                tuple_(StructuredTable.source_app_token, StructuredTable.source_table_id).in_(my_st_keys),
                StructuredTable.owner_id != my_owner_id,
            )
        )).all()
        st_archive_count = len(st_others)
        st_archive_users.update(r[0] for r in st_others)
        st_referenced_keys.update((r[1], r[2]) for r in st_others)

    total_archives = doc_archive_count + st_archive_count
    archive_sub = min(50, int(_log_score(total_archives, 50) * 0.5))

    unique_users = len(doc_archive_users | st_archive_users)
    user_sub = min(30, int(_log_score(unique_users, 20) * 0.3))

    # 覆盖率分母：所有"数据所有人是我"的内容总数（包括本地上传）
    # 排除：我导入的但原始所有人不是我的内容（_original_owner.id 存在且 != 我）
    my_doc_total = (await db.execute(
        select(func.count()).select_from(Document).where(
            Document.owner_id == my_owner_id,
            or_(
                Document.extra_fields["_original_owner"]["id"].astext == my_owner_id,
                Document.extra_fields["_original_owner"]["id"].astext.is_(None),
            ),
        )
    )).scalar() or 0
    my_st_total = (await db.execute(
        select(func.count()).select_from(StructuredTable).where(
            StructuredTable.owner_id == my_owner_id,
            or_(
                StructuredTable.extra_fields["_original_owner"]["id"].astext == my_owner_id,
                StructuredTable.extra_fields["_original_owner"]["id"].astext.is_(None),
            ),
        )
    )).scalar() or 0
    my_original_count = my_doc_total + my_st_total
    referenced_count = len(doc_referenced_frids) + len(st_referenced_keys)
    ref_coverage = referenced_count / my_original_count if my_original_count > 0 else 0.0
    coverage_sub = min(20, int(ref_coverage * 20))

    dim_impact_score = archive_sub + user_sub + coverage_sub
    dim_impact_detail = f"被他人归档 {total_archives} 次 · {unique_users} 位不同用户 · 覆盖 {ref_coverage:.0%}"

    # ═══ 构建维度列表 ═══
    def _make_dim(key: str, label: str, weight: float, score: int, detail: str,
                  sub_scores: list[SubScoreDetail], route: str | None, action_label: str | None) -> ScoreDimension:
        action = None
        if score < 70 and route and action_label:
            action = ScoreAction(label=action_label, route=route)
        return ScoreDimension(key=key, label=label, weight=weight, score=min(100, score),
                              detail=detail, sub_scores=sub_scores, action=action)

    dimensions: list[ScoreDimension] = []

    dimensions.append(_make_dim(
        "quality", "内容质量", 0.30, dim_quality_score, dim_quality_detail,
        [
            SubScoreDetail(key="quality_avg", label="ETL 质量均分", weight=0.4,
                           score=quality_avg_score, max_score=40, value=f"{avg_quality:.2f}",
                           criteria=["≥0.85 → 36-40分", "0.7-0.85 → 28-36分", "0.5-0.7 → 20-28分", "0.3-0.5 → 12-20分", "<0.3 → 0-12分"]),
            SubScoreDetail(key="high_quality_ratio", label="高质量内容占比", weight=0.35,
                           score=high_quality_score, max_score=35, value=f"{high_quality_ratio:.0%}",
                           criteria=["≥70% → 30-35分", "50-70% → 22-30分", "30-50% → 15-22分", "10-30% → 8-15分", "<10% → 0-8分"]),
            SubScoreDetail(key="field_completeness", label="字段完整率", weight=0.25,
                           score=field_completeness_score, max_score=25, value=f"{completeness_ratio:.0%}",
                           criteria=["按比例: 完整率 × 25"]),
        ],
        "/data-import", "去导入数据",
    ))

    dimensions.append(_make_dim(
        "completeness", "数据完备度", 0.20, dim_completeness_score, dim_completeness_detail,
        [
            SubScoreDetail(key="volume", label="数据量", weight=0.5,
                           score=volume_sub, max_score=50, value=str(scored_total),
                           criteria=["对数曲线: ~1000条满分"]),
            SubScoreDetail(key="type_coverage", label="类型覆盖", weight=0.25,
                           score=type_coverage_sub, max_score=25, value=f"{type_count}/3",
                           criteria=["3种→25分", "2种→18分", "1种→10分", "0种→0分"]),
            SubScoreDetail(key="source_count", label="数据源数量", weight=0.25,
                           score=source_count_sub, max_score=25, value=str(total_sources),
                           criteria=["对数曲线: ~10个满分"]),
        ],
        "/data-import", "去导入数据",
    ))

    dimensions.append(_make_dim(
        "tags", "标签规范度", 0.20, dim_tags_score, dim_tags_detail,
        [
            SubScoreDetail(key="tag_coverage", label="标签覆盖率", weight=0.4,
                           score=tag_coverage_sub, max_score=40, value=f"{tag_coverage_ratio:.0%}",
                           criteria=["按比例: 覆盖率 × 40"]),
            SubScoreDetail(key="tag_diversity", label="标签多样性", weight=0.35,
                           score=tag_diversity_sub, max_score=35, value=f"{distinct_tag_count} 种",
                           criteria=["10+种→35分", "按比例递减"]),
            SubScoreDetail(key="tag_depth", label="标签深度", weight=0.25,
                           score=tag_depth_sub, max_score=25, value=f"均 {avg_tags_per_item:.1f} 个",
                           criteria=["均3+个/条→25分", "按比例递减"]),
        ],
        "/settings?tab=tags", "去管理标签",
    ))

    dimensions.append(_make_dim(
        "freshness", "数据时效性", 0.15, dim_freshness_score, dim_freshness_detail,
        [
            SubScoreDetail(key="recent_ratio", label="近期更新率", weight=0.6,
                           score=freshness_sub, max_score=60, value=f"{freshness_ratio:.0%}",
                           criteria=["按比例: 更新率 × 60"]),
            SubScoreDetail(key="regularity", label="更新规律性", weight=0.4,
                           score=regularity_sub, max_score=40, value=f"{days_count}/30 天",
                           criteria=["按比例: 活跃天数/30 × 40"]),
        ],
        "/data-import", "去同步数据",
    ))

    dimensions.append(_make_dim(
        "impact", "数据影响力", 0.15, dim_impact_score, dim_impact_detail,
        [
            SubScoreDetail(key="archive_count", label="被他人归档次数", weight=0.5,
                           score=archive_sub, max_score=50, value=f"{total_archives} 次",
                           criteria=["对数曲线: ~50次满分"]),
            SubScoreDetail(key="unique_users", label="不同归档用户数", weight=0.3,
                           score=user_sub, max_score=30, value=f"{unique_users} 人",
                           criteria=["对数曲线: ~20人满分"]),
            SubScoreDetail(key="ref_coverage", label="被引内容覆盖率", weight=0.2,
                           score=coverage_sub, max_score=20, value=f"{ref_coverage:.0%}",
                           criteria=["按比例: 覆盖率 × 20"]),
        ],
        None, None,
    ))

    # ═══ 加权总分 ═══
    total_score = int(sum(d.score * d.weight for d in dimensions))

    return AssetScoreResponse(total_score=total_score, level=_level(total_score), dimensions=dimensions)
