# 数据评分体系重新设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing 7-dimension simple-average scoring with a 5-dimension weighted scoring system focused on data quality, with expandable sub-score criteria in the UI.

**Architecture:** Backend rewrites `GET /api/assets/score` with new helper functions (`_tier_score`, per-dimension calculators). Schema adds `SubScoreDetail` and extends `ScoreDimension` with `weight` and `sub_scores`. Frontend updates `AssetScoreWidget.tsx` to show expandable sub-score panels.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React/TypeScript/Recharts/Tailwind (frontend)

**Spec:** `docs/superpowers/specs/2026-03-18-asset-score-redesign.md`

---

### Task 1: Update Pydantic Schema

**Files:**
- Modify: `backend/app/schemas/asset.py`
- Test: `backend/tests/test_assets.py`

- [ ] **Step 1: Update schema file with new models**

```python
"""资产统计 Pydantic 模型。"""

from pydantic import BaseModel


class AssetStatsResponse(BaseModel):
    """统一看板统计响应。"""
    total: int
    by_table: dict[str, int]
    today_new: dict[str, int]
    recent_trend: list[dict]


class ScoreAction(BaseModel):
    label: str
    route: str


class SubScoreDetail(BaseModel):
    """子指标详情。"""
    key: str
    label: str
    weight: float
    score: int
    max_score: int
    value: str
    criteria: list[str]


class ScoreDimension(BaseModel):
    key: str
    label: str
    weight: float
    score: int
    detail: str
    sub_scores: list[SubScoreDetail] = []
    action: ScoreAction | None = None


class AssetScoreResponse(BaseModel):
    total_score: int
    level: str
    dimensions: list[ScoreDimension]
```

- [ ] **Step 2: Update schema test**

In `backend/tests/test_assets.py`, update or add a test for the new schema structure:

```python
def test_asset_score_response_schema(self):
    """AssetScoreResponse schema 可正确序列化。"""
    from app.schemas.asset import AssetScoreResponse, ScoreDimension, SubScoreDetail

    dim = ScoreDimension(
        key="quality",
        label="内容质量",
        weight=0.30,
        score=62,
        detail="质量均分 0.68",
        sub_scores=[
            SubScoreDetail(
                key="quality_avg",
                label="ETL 质量均分",
                weight=0.4,
                score=34,
                max_score=40,
                value="0.68",
                criteria=["≥0.85 → 36-40分", "<0.3 → 0-12分"],
            )
        ],
    )
    resp = AssetScoreResponse(total_score=52, level="良好", dimensions=[dim])
    data = resp.model_dump()
    assert data["total_score"] == 52
    assert data["dimensions"][0]["weight"] == 0.30
    assert data["dimensions"][0]["sub_scores"][0]["max_score"] == 40
```

- [ ] **Step 3: Run tests to verify**

Run: `cd backend && pytest tests/test_assets.py -v`
Expected: All tests pass (some old schema tests may need updating if they reference removed fields like `by_type`).

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/asset.py backend/tests/test_assets.py
git commit -m "refactor: 更新评分 Schema，新增 SubScoreDetail 和权重字段"
```

---

### Task 2: Add Helper Functions

**Files:**
- Modify: `backend/app/api/assets.py` (lines 90-116, helper function section)
- Test: `backend/tests/test_score_helpers.py` (create)

- [ ] **Step 1: Create test file for helpers**

Create `backend/tests/test_score_helpers.py`:

```python
"""评分辅助函数测试。"""

import pytest


class TestTierScore:
    """阶梯插值函数测试。"""

    def test_highest_tier(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.70, 0.85, 28, 36), (0.0, 0.30, 0, 12)]
        assert _tier_score(0.95, tiers) == 38  # (0.95-0.85)/(1.0-0.85)=0.667 -> 36+int(0.667*4)=38

    def test_mid_tier(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.70, 0.85, 28, 36), (0.50, 0.70, 20, 28), (0.0, 0.30, 0, 12)]
        assert _tier_score(0.75, tiers) == 30  # (0.75-0.70)/(0.85-0.70)=0.333 -> 28+int(0.333*8)=30

    def test_below_all_tiers(self):
        from app.api.assets import _tier_score
        tiers = [(0.30, 0.50, 12, 20), (0.10, 0.30, 5, 12)]
        assert _tier_score(0.05, tiers) == 0

    def test_exact_boundary(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.70, 0.85, 28, 36)]
        assert _tier_score(0.85, tiers) == 36  # exactly on boundary -> min of that tier

    def test_zero_value(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.0, 0.30, 0, 12)]
        assert _tier_score(0.0, tiers) == 0

    def test_quality_avg_tiers_full_range(self):
        """验证 ETL 质量均分阶梯常量的完整区间覆盖。"""
        from app.api.assets import _tier_score, _QUALITY_AVG_TIERS
        assert _tier_score(1.0, _QUALITY_AVG_TIERS) == 40  # max
        assert _tier_score(0.5, _QUALITY_AVG_TIERS) == 20  # mid boundary
        assert _tier_score(0.0, _QUALITY_AVG_TIERS) == 0   # min

    def test_high_quality_tiers_full_range(self):
        """验证高质量占比阶梯常量的完整区间覆盖。"""
        from app.api.assets import _tier_score, _HIGH_QUALITY_TIERS
        assert _tier_score(1.0, _HIGH_QUALITY_TIERS) == 35  # max
        assert _tier_score(0.0, _HIGH_QUALITY_TIERS) == 0   # min


class TestLogScore:
    """对数曲线评分测试。"""

    def test_zero(self):
        from app.api.assets import _log_score
        assert _log_score(0) == 0

    def test_max_ref(self):
        from app.api.assets import _log_score
        assert _log_score(500, 500) == 100

    def test_custom_max(self):
        from app.api.assets import _log_score
        score = _log_score(1000, 1000)
        assert score == 100

    def test_half_log(self):
        from app.api.assets import _log_score
        score = _log_score(22, 500)  # log(23)/log(501) ≈ 0.504
        assert 45 <= score <= 55


class TestLevel:
    """等级映射测试。"""

    def test_levels(self):
        from app.api.assets import _level
        assert _level(95) == "卓越"
        assert _level(90) == "卓越"
        assert _level(75) == "优秀"
        assert _level(70) == "优秀"
        assert _level(55) == "良好"
        assert _level(50) == "良好"
        assert _level(40) == "待提升"
        assert _level(0) == "待提升"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_score_helpers.py -v`
Expected: `TestTierScore` tests FAIL (function doesn't exist yet), `TestLogScore` and `TestLevel` pass.

- [ ] **Step 3: Add `_tier_score` function to assets.py**

Add after the existing `_level` function (line 115 area):

```python
def _tier_score(value: float, tiers: list[tuple[float, float, int, int]]) -> int:
    """阶梯内线性插值。tiers: [(lower, upper, min_score, max_score), ...] 从高到低排列。"""
    for lower, upper, min_s, max_s in tiers:
        if value >= lower:
            if upper <= lower:
                return max_s
            ratio = min((value - lower) / (upper - lower), 1.0)
            return min_s + int(ratio * (max_s - min_s))
    return 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_score_helpers.py -v`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/assets.py backend/tests/test_score_helpers.py
git commit -m "feat: 新增 _tier_score 阶梯插值函数"
```

---

### Task 3: Rewrite Backend Scoring Logic

**Files:**
- Modify: `backend/app/api/assets.py` (rewrite `get_asset_score` function, lines 118-327)

This is the core task. Replace the entire `get_asset_score` function body with the new 5-dimension weighted logic.

- [ ] **Step 1: Update imports**

At the top of `assets.py`, ensure these imports exist (add `tuple_` to the sqlalchemy import if not already top-level):

```python
from sqlalchemy import cast, Date, distinct, func, select, tuple_
```

Remove unused model imports that are no longer needed (KGEntity, KGRelation, ExtractionRule, CleaningRule will be removed). Also remove `or_` and `Float` from the sqlalchemy import (no longer used). Remove the inline `from sqlalchemy import tuple_` at the existing line 177 (moved to top-level import).

Update the schema import:
```python
from app.schemas.asset import AssetScoreResponse, AssetStatsResponse, ScoreAction, ScoreDimension, SubScoreDetail
```

- [ ] **Step 2: Define scoring constants**

Add after the helper functions, before `get_asset_score`:

```python
# 参评的 Communication 类型（排除 chat）
SCORED_COMM_TYPES = ("meeting", "recording")

# ETL 质量均分阶梯 (子权重 0.4, 满分 40)
_QUALITY_AVG_TIERS = [
    (0.85, 1.0,  36, 40),
    (0.70, 0.85, 28, 36),
    (0.50, 0.70, 20, 28),
    (0.30, 0.50, 12, 20),
    (0.00, 0.30,  0, 12),
]

# 高质量内容占比阶梯 (子权重 0.35, 满分 35)
_HIGH_QUALITY_TIERS = [
    (0.70, 1.0,  30, 35),
    (0.50, 0.70, 22, 30),
    (0.30, 0.50, 15, 22),
    (0.10, 0.30,  8, 15),
    (0.00, 0.10,  0,  8),
]
```

- [ ] **Step 3: Rewrite `get_asset_score` — counted queries section**

Replace the function body. First section: count scored content.

```python
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
```

- [ ] **Step 4: Implement dimension 1 — 内容质量 (30%)**

Continue the function:

```python
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
```

- [ ] **Step 5: Implement dimension 2 — 数据完备度 (20%)**

```python
    # ═══ 维度 2: 数据完备度 (权重 20%) ═══
    # 2a. 数据量 (log curve, max_ref=1000, 子权重50%, 满分50)
    volume_sub = min(50, int(_log_score(scored_total, 1000) * 0.5))

    # 2b. 类型覆盖 (3 种类型, 子权重25%, 满分25)
    type_count = sum(1 for c in [doc_count, table_count, meeting_count] if c > 0)
    type_coverage_sub = {0: 0, 1: 10, 2: 18, 3: 25}[type_count]

    # 2c. 数据源数量 (ETLDataSource + CloudFolderSource, 子权重25%, 满分25)
    etl_source_count_stmt = select(func.count()).select_from(ETLDataSource).where(
        ETLDataSource.owner_id == my_owner_id
    )
    etl_src_count = (await db.execute(etl_source_count_stmt)).scalar() or 0
    folder_count_stmt = select(func.count()).select_from(CloudFolderSource).where(
        CloudFolderSource.owner_id == my_owner_id
    )
    folder_src_count = (await db.execute(folder_count_stmt)).scalar() or 0
    total_sources = etl_src_count + folder_src_count
    source_count_sub = min(25, int(_log_score(total_sources, 10) * 0.25))

    dim_completeness_score = volume_sub + type_coverage_sub + source_count_sub
    dim_completeness_detail = f"数据 {scored_total} 条 · {type_count}/3 类型 · {total_sources} 个数据源"
```

- [ ] **Step 6: Implement dimension 3 — 标签规范度 (20%)**

```python
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

    # 3b. 标签多样性 (使用了多少种不同标签, 子权重35%, 满分35)
    distinct_tags_stmt = (
        select(func.count(distinct(ContentTag.tag_id)))
    )
    # 限制到参评内容
    scored_ids_subqueries = []
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
        scored_ids_subqueries.append((ct, sub_q))

    distinct_tag_count = 0
    all_tag_ids: set[int] = set()
    total_tag_assignments = 0
    for ct, sub_q in scored_ids_subqueries:
        # distinct tags
        dt_stmt = select(distinct(ContentTag.tag_id)).where(
            ContentTag.content_type == ct, ContentTag.content_id.in_(sub_q)
        )
        rows = (await db.execute(dt_stmt)).all()
        all_tag_ids.update(r[0] for r in rows)
        # total assignments (for depth calc)
        ta_stmt = select(func.count()).select_from(ContentTag).where(
            ContentTag.content_type == ct, ContentTag.content_id.in_(sub_q)
        )
        total_tag_assignments += (await db.execute(ta_stmt)).scalar() or 0

    distinct_tag_count = len(all_tag_ids)
    tag_diversity_sub = min(35, int(min(distinct_tag_count, 10) / 10 * 35))

    # 3c. 标签深度 (平均每条被标签内容的标签数, 子权重25%, 满分25)
    avg_tags_per_item = total_tag_assignments / tagged_count if tagged_count > 0 else 0.0
    tag_depth_sub = min(25, int(min(avg_tags_per_item, 3.0) / 3.0 * 25))

    dim_tags_score = tag_coverage_sub + tag_diversity_sub + tag_depth_sub
    dim_tags_detail = f"覆盖 {tag_coverage_ratio:.0%} · {distinct_tag_count} 种标签 · 均 {avg_tags_per_item:.1f} 个/条"
```

- [ ] **Step 7: Implement dimension 4 — 数据时效性 (15%)**

```python
    # ═══ 维度 4: 数据时效性 (权重 15%) ═══
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)

    # 4a. 近期更新率 (子权重60%, 满分60)
    recent_count = 0
    for model, extra in [(Document, None), (StructuredTable, None),
                          (Communication, Communication.comm_type.in_(SCORED_COMM_TYPES))]:
        recent_count += await _count(model, model.created_at >= thirty_days_ago if extra is None
                                     else (model.created_at >= thirty_days_ago) & extra)
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
```

- [ ] **Step 8: Implement dimension 5 — 数据影响力 (15%)**

```python
    # ═══ 维度 5: 数据影响力 (权重 15%) — 仅文档 + 表格 ═══
    # 5a. 被归档总次数 (子权重50%, 满分50)
    # 找出我原创的文档 feishu_record_id
    my_doc_frids_stmt = select(distinct(Document.feishu_record_id)).where(
        Document.feishu_record_id.isnot(None),
        Document.extra_fields["_original_owner"]["id"].astext == my_owner_id,
    )
    my_doc_frids = [r[0] for r in (await db.execute(my_doc_frids_stmt)).all()]

    doc_archive_count = 0
    doc_archive_users: set[str] = set()
    doc_referenced_frids: set[str] = set()
    if my_doc_frids:
        doc_others_stmt = select(Document.owner_id, Document.feishu_record_id).where(
            Document.feishu_record_id.in_(my_doc_frids),
            Document.owner_id != my_owner_id,
        )
        doc_others = (await db.execute(doc_others_stmt)).all()
        doc_archive_count = len(doc_others)
        doc_archive_users.update(r[0] for r in doc_others)
        doc_referenced_frids.update(r[1] for r in doc_others)

    # 找出我原创的表格 (app_token, table_id)
    my_st_keys_stmt = select(StructuredTable.source_app_token, StructuredTable.source_table_id).where(
        StructuredTable.source_app_token.isnot(None),
        StructuredTable.source_table_id.isnot(None),
        StructuredTable.extra_fields["_original_owner"]["id"].astext == my_owner_id,
    )
    my_st_keys = list({(r[0], r[1]) for r in (await db.execute(my_st_keys_stmt)).all()})

    st_archive_count = 0
    st_archive_users: set[str] = set()
    st_referenced_keys: set[tuple] = set()
    if my_st_keys:
        st_others_stmt = select(
            StructuredTable.owner_id,
            StructuredTable.source_app_token,
            StructuredTable.source_table_id,
        ).where(
            tuple_(StructuredTable.source_app_token, StructuredTable.source_table_id).in_(my_st_keys),
            StructuredTable.owner_id != my_owner_id,
        )
        st_others = (await db.execute(st_others_stmt)).all()
        st_archive_count = len(st_others)
        st_archive_users.update(r[0] for r in st_others)
        st_referenced_keys.update((r[1], r[2]) for r in st_others)

    total_archives = doc_archive_count + st_archive_count
    archive_sub = min(50, int(_log_score(total_archives, 50) * 0.5))

    # 5b. 独立引用人数 (子权重30%, 满分30)
    unique_users = len(doc_archive_users | st_archive_users)
    user_sub = min(30, int(_log_score(unique_users, 20) * 0.3))

    # 5c. 被引内容覆盖率 (子权重20%, 满分20)
    my_original_count = len(my_doc_frids) + len(my_st_keys)
    referenced_count = len(doc_referenced_frids) + len(st_referenced_keys)
    ref_coverage = referenced_count / my_original_count if my_original_count > 0 else 0.0
    coverage_sub = min(20, int(ref_coverage * 20))

    dim_impact_score = archive_sub + user_sub + coverage_sub
    dim_impact_detail = f"被归档 {total_archives} 次 · {unique_users} 人引用 · 覆盖 {ref_coverage:.0%}"
```

- [ ] **Step 9: Build dimensions list and return**

```python
    # ═══ 构建维度列表 ═══
    dimensions: list[ScoreDimension] = []

    def _make_dim(key: str, label: str, weight: float, score: int, detail: str,
                  sub_scores: list[SubScoreDetail], route: str | None, action_label: str | None) -> ScoreDimension:
        action = None
        if score < 70 and route and action_label:
            action = ScoreAction(label=action_label, route=route)
        return ScoreDimension(key=key, label=label, weight=weight, score=min(100, score),
                              detail=detail, sub_scores=sub_scores, action=action)

    # 维度 1: 内容质量
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

    # 维度 2: 数据完备度
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

    # 维度 3: 标签规范度
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

    # 维度 4: 数据时效性
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

    # 维度 5: 数据影响力
    dimensions.append(_make_dim(
        "impact", "数据影响力", 0.15, dim_impact_score, dim_impact_detail,
        [
            SubScoreDetail(key="archive_count", label="被归档总次数", weight=0.5,
                           score=archive_sub, max_score=50, value=str(total_archives),
                           criteria=["对数曲线: ~50次满分"]),
            SubScoreDetail(key="unique_users", label="独立引用人数", weight=0.3,
                           score=user_sub, max_score=30, value=f"{unique_users} 人",
                           criteria=["对数曲线: ~20人满分"]),
            SubScoreDetail(key="ref_coverage", label="被引内容覆盖率", weight=0.2,
                           score=coverage_sub, max_score=20, value=f"{ref_coverage:.0%}",
                           criteria=["按比例: 覆盖率 × 20"]),
        ],
        None, None,  # 无优化建议（依赖他人行为）
    ))

    # ═══ 加权总分 ═══
    total_score = int(sum(d.score * d.weight for d in dimensions))

    return AssetScoreResponse(total_score=total_score, level=_level(total_score), dimensions=dimensions)
```

- [ ] **Step 10: Clean up removed imports**

Remove these model imports from the top of `assets.py` (no longer used):
- `KGEntity`, `KGRelation` (if only used in score)
- `ExtractionRule`, `CleaningRule` (if only used in score)

Check if they're used in other functions in this file first. If `get_asset_stats` doesn't use them, remove them.

- [ ] **Step 11: Verify backend starts**

Run: `cd backend && python -c "from app.api.assets import get_asset_score; print('OK')"`
Expected: "OK" (no import errors)

- [ ] **Step 12: Commit**

```bash
git add backend/app/api/assets.py
git commit -m "feat: 重写评分逻辑为5维度加权体系"
```

---

### Task 4: Update Frontend TypeScript Types and Widget

**Files:**
- Modify: `frontend/src/components/insights/AssetScoreWidget.tsx`

- [ ] **Step 1: Update TypeScript interfaces**

Replace the existing interfaces at the top of the file:

```typescript
interface SubScoreDetail {
  key: string
  label: string
  weight: number
  score: number
  max_score: number
  value: string
  criteria: string[]
}

interface ScoreAction {
  label: string
  route: string
}

interface ScoreDimension {
  key: string
  label: string
  weight: number
  score: number
  detail: string
  sub_scores: SubScoreDetail[]
  action: ScoreAction | null
}

interface AssetScore {
  total_score: number
  level: string
  dimensions: ScoreDimension[]
}
```

- [ ] **Step 2: Add expanded state and sub-score panel**

Add state for tracking which dimension is expanded:

```typescript
const [expandedKey, setExpandedKey] = useState<string | null>(null)
```

Replace the dimension list section (the `data.dimensions.map(...)` block) with:

```tsx
{data.dimensions.map((dim) => (
  <div key={dim.key} className="rounded-lg hover:bg-gray-50/50 transition-colors">
    {/* Header row — clickable to expand */}
    <button
      onClick={() => setExpandedKey(expandedKey === dim.key ? null : dim.key)}
      className={`w-full ${compact ? 'py-1 px-2' : 'py-2 px-3'} flex items-center gap-3 text-left`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-700`}>
            {dim.label}
            {!compact && (
              <span className="ml-1.5 text-[10px] text-gray-400 font-normal">{Math.round(dim.weight * 100)}%</span>
            )}
          </span>
          <span className={`${compact ? 'text-xs' : 'text-sm'} font-semibold ${dim.score >= 70 ? 'text-gray-600' : 'text-amber-600'}`}>
            {dim.score}
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              dim.score >= 90 ? 'bg-emerald-500'
                : dim.score >= 70 ? 'bg-indigo-500'
                  : dim.score >= 50 ? 'bg-amber-500'
                    : 'bg-red-500'
            }`}
            style={{ width: `${dim.score}%` }}
          />
        </div>
        {!compact && <p className="text-[11px] text-gray-400 mt-0.5">{dim.detail}</p>}
      </div>
      {!compact && (
        <svg className={`w-4 h-4 text-gray-300 transition-transform ${expandedKey === dim.key ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      )}
    </button>

    {/* Expanded sub-scores panel */}
    {!compact && expandedKey === dim.key && (
      <div className="px-3 pb-3 space-y-2">
        {dim.sub_scores.map((sub) => (
          <div key={sub.key} className="bg-gray-50 rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">
                {sub.label}
                <span className="ml-1 text-[10px] text-gray-400 font-normal">({Math.round(sub.weight * 100)}%)</span>
              </span>
              <span className="text-xs font-semibold text-gray-600">{sub.score}/{sub.max_score}</span>
            </div>
            <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                style={{ width: `${sub.max_score > 0 ? (sub.score / sub.max_score) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-indigo-600 font-medium bg-indigo-50 px-1.5 py-0.5 rounded">
                你: {sub.value}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {sub.criteria.map((c, i) => (
                <span key={i} className="text-[10px] text-gray-400 bg-white px-1.5 py-0.5 rounded border border-gray-100">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}

        {/* Action button inside expanded panel */}
        {dim.action && (
          <button
            onClick={(e) => { e.stopPropagation(); handleAction(dim.action!) }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
          >
            <ArrowRight size={12} />
            {dim.action.label}
          </button>
        )}
      </div>
    )}
  </div>
))}
```

- [ ] **Step 3: Remove the old action button from outside the expanded panel**

The action button is now inside the expanded panel. Remove the old standalone action button that was outside the dimension row.

- [ ] **Step 4: Remove the KG build action handler**

The knowledge graph dimension has been removed, so the `__action:build_kg` handling is no longer needed. Simplify `handleAction`:

```typescript
const handleAction = (action: ScoreAction) => {
  navigate(action.route)
}
```

Also remove the `buildingKG` state and its setter. Remove `Loader2` from the lucide-react import (no longer used).

- [ ] **Step 5: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/insights/AssetScoreWidget.tsx
git commit -m "feat: 前端评分组件支持子指标展开和评分标准展示"
```

---

### Task 5: Integration Test and Final Cleanup

**Files:**
- Verify: `backend/tests/test_assets.py` (all tests pass)
- Verify: `frontend/` (build succeeds)

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && pytest tests/ -v`
Expected: All pass. Fix any test failures from schema changes (old tests may reference removed fields like `by_type` in `AssetStatsResponse`).

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: No errors.

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend && npm run lint`
Expected: No errors (fix any if found).

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: 修复评分重构后的测试和类型问题"
```

- [ ] **Step 5: Push to remote**

```bash
git push
```
