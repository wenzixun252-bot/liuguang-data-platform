# Asset Score Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal data asset archival score to the DataInsights page, showing a 0-100 total score with radar chart and actionable optimization buttons per dimension.

**Architecture:** Backend computes 7 scoring dimensions via a new `GET /api/assets/score` endpoint. Frontend renders the score in a new `AssetScoreWidget` registered in the widget system. Uses Recharts RadarChart for visualization.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), React + TypeScript + Recharts + Tailwind (frontend)

---

## Chunk 1: Backend API

### Task 1: Add Score Schema

**Files:**
- Modify: `backend/app/schemas/asset.py`

- [ ] **Step 1: Add Pydantic models for score response**

```python
# Append to backend/app/schemas/asset.py

class ScoreAction(BaseModel):
    label: str
    route: str

class ScoreDimension(BaseModel):
    key: str
    label: str
    score: int
    detail: str
    action: ScoreAction | None = None

class AssetScoreResponse(BaseModel):
    total_score: int
    level: str
    dimensions: list[ScoreDimension]
```

- [ ] **Step 2: Verify import works**

Run: `cd backend && python -c "from app.schemas.asset import AssetScoreResponse; print('OK')"`
Expected: OK

---

### Task 2: Implement Score Endpoint

**Files:**
- Modify: `backend/app/api/assets.py`

- [ ] **Step 1: Add imports at top of assets.py**

Add these imports to the existing import block:

```python
import math
from sqlalchemy import distinct

from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.tag import ContentTag
from app.models.asset import ETLDataSource, CloudFolderSource
from app.schemas.asset import AssetScoreResponse, ScoreDimension, ScoreAction
```

- [ ] **Step 2: Add scoring helper functions**

Add after the existing `get_asset_stats` endpoint:

```python
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
```

- [ ] **Step 3: Add the /score endpoint**

```python
@router.get("/score", response_model=AssetScoreResponse, summary="个人数据资产评分")
async def get_asset_score(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetScoreResponse:
    """计算当前用户的数据资产归档评分（7个维度）。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

    # Helper: count with RLS
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
    quality_vals = []
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
    # Count distinct content items that have at least one tag
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
    # Check 3 asset types: document (ETL or CloudFolder), communication, structured
    activated_types = set()
    # Check ETLDataSource
    etl_stmt = (
        select(distinct(ETLDataSource.asset_type))
        .where(ETLDataSource.is_enabled == True)
    )
    if visible_ids is not None:
        etl_stmt = etl_stmt.where(
            (ETLDataSource.owner_id.in_(visible_ids)) | (ETLDataSource.owner_id.is_(None))
        )
    etl_types = (await db.execute(etl_stmt)).scalars().all()
    activated_types.update(etl_types)
    # Check CloudFolderSource for document type
    cf_stmt = select(func.count()).select_from(CloudFolderSource).where(CloudFolderSource.is_enabled == True)
    if visible_ids is not None:
        cf_stmt = cf_stmt.where(CloudFolderSource.owner_id.in_(visible_ids))
    if (await db.execute(cf_stmt)).scalar() or 0 > 0:
        activated_types.add("document")
    sources_score = int(len(activated_types.intersection({"document", "communication", "structured"})) / 3 * 100)

    # --- Build dimensions ---
    dims = [
        ("volume", "数据量", volume_score, f"共 {total_count} 条数据资产", "/documents", "去导入数据"),
        ("quality", "数据质量", quality_score, f"平均质量 {sum(quality_vals)/len(quality_vals):.2f}" if quality_vals else "暂无数据", None, None),
        ("knowledge", "知识图谱", knowledge_score, f"{entity_count} 个实体, {relation_count} 条关系", None, "构建图谱"),
        ("tags", "标签覆盖", tags_score, f"{tagged_count}/{total_count} 已标签", "/settings", "去管理标签"),
        ("activity", "活跃度", activity_score, f"近30天新增 {recent_count} 条", "/documents", "去同步数据"),
        ("vectorization", "AI可搜索", vectorization_score, f"{vectorized_count}/{total_count} 已向量化", None, None),
        ("sources", "数据源激活", sources_score, f"已激活 {len(activated_types.intersection({'document','communication','structured'}))}/3 类数据源", "/settings", "去开启同步"),
    ]

    dimensions = []
    for key, label, score, detail, route, action_label in dims:
        action = None
        if score < 70 and route and action_label:
            action = ScoreAction(label=action_label, route=route)
        # Special actions: knowledge triggers KG build, not a route
        if key == "knowledge" and score < 70:
            action = ScoreAction(label="构建图谱", route="__action:build_kg")
        dimensions.append(ScoreDimension(key=key, label=label, score=score, detail=detail, action=action))

    all_scores = [d.score for d in dimensions]
    total = int(sum(all_scores) / len(all_scores))

    return AssetScoreResponse(total_score=total, level=_level(total), dimensions=dimensions)
```

- [ ] **Step 4: Verify endpoint loads**

Run: `cd backend && python -c "from app.api.assets import router; print([r.path for r in router.routes])"`
Expected: Output includes `/score`

- [ ] **Step 5: Commit backend changes**

```bash
git add backend/app/schemas/asset.py backend/app/api/assets.py
git commit -m "feat: add GET /api/assets/score endpoint for personal data asset scoring"
```

---

## Chunk 2: Frontend Widget

### Task 3: Register Widget in Config

**Files:**
- Modify: `frontend/src/hooks/useWidgetConfig.ts`

- [ ] **Step 1: Add 'asset-score' to WidgetId type and defaults**

In `useWidgetConfig.ts`:

1. Update WidgetId type:
```typescript
export type WidgetId = 'data-graph' | 'trend' | 'asset-score'
```

2. Add to DEFAULT_CONFIGS:
```typescript
const DEFAULT_CONFIGS: WidgetConfig[] = [
  { id: 'asset-score', enabled: true, order: 0, settings: {} },
  { id: 'data-graph', enabled: true, order: 1, settings: {} },
  { id: 'trend', enabled: true, order: 2, settings: {} },
]
```

3. Update loadConfigs length check — change from strict length equality to a merge approach:
```typescript
function loadConfigs(): WidgetConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as WidgetConfig[]
      if (Array.isArray(parsed)) {
        // Merge: keep saved configs, add any new defaults
        const savedIds = new Set(parsed.map(c => c.id))
        const merged = [...parsed]
        for (const def of DEFAULT_CONFIGS) {
          if (!savedIds.has(def.id)) {
            merged.push({ ...def, order: merged.length })
          }
        }
        return merged
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_CONFIGS.map(c => ({ ...c }))
}
```

---

### Task 4: Create AssetScoreWidget Component

**Files:**
- Create: `frontend/src/components/insights/AssetScoreWidget.tsx`

- [ ] **Step 1: Create the widget file**

```tsx
import { useState, useEffect } from 'react'
import { Shield, ArrowRight, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts'
import api from '../../lib/api'
import toast from 'react-hot-toast'
import WidgetContainer from './WidgetContainer'

interface ScoreAction {
  label: string
  route: string
}

interface ScoreDimension {
  key: string
  label: string
  score: number
  detail: string
  action: ScoreAction | null
}

interface AssetScore {
  total_score: number
  level: string
  dimensions: ScoreDimension[]
}

const LEVEL_COLORS: Record<string, string> = {
  '卓越': 'text-emerald-500',
  '优秀': 'text-indigo-500',
  '良好': 'text-amber-500',
  '待提升': 'text-red-500',
}

const LEVEL_BG: Record<string, string> = {
  '卓越': 'from-emerald-500 to-emerald-600',
  '优秀': 'from-indigo-500 to-purple-600',
  '良好': 'from-amber-500 to-amber-600',
  '待提升': 'from-red-500 to-red-600',
}

export default function AssetScoreWidget({ onClose }: { onClose?: () => void }) {
  const [data, setData] = useState<AssetScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buildingKG, setBuildingKG] = useState(false)
  const navigate = useNavigate()

  const fetchScore = () => {
    setLoading(true)
    setError(null)
    api
      .get('/assets/score')
      .then((res) => setData(res.data))
      .catch(() => setError('加载评分失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchScore()
  }, [])

  const handleAction = async (action: ScoreAction) => {
    if (action.route === '__action:build_kg') {
      setBuildingKG(true)
      try {
        await api.post('/knowledge-graph/build-and-analyze')
        toast.success('知识图谱构建已启动，完成后评分将自动更新')
      } catch {
        toast.error('启动构建失败')
      } finally {
        setBuildingKG(false)
      }
    } else {
      navigate(action.route)
    }
  }

  const radarData = data?.dimensions.map((d) => ({
    dimension: d.label,
    score: d.score,
    fullMark: 100,
  })) || []

  const levelGradient = data ? (LEVEL_BG[data.level] || LEVEL_BG['良好']) : ''
  const levelColor = data ? (LEVEL_COLORS[data.level] || '') : ''

  return (
    <WidgetContainer
      id="asset-score"
      title="数据资产评分"
      icon={<Shield size={20} />}
      loading={loading}
      error={error}
      onRetry={fetchScore}
      onClose={onClose}
    >
      {data && (
        <div className="space-y-5">
          {/* Score header */}
          <div className="flex items-center gap-6">
            {/* Big score circle */}
            <div className={`relative flex-shrink-0 w-28 h-28 rounded-full bg-gradient-to-br ${levelGradient} flex items-center justify-center shadow-lg`}>
              <div className="text-center text-white">
                <div className="text-3xl font-bold leading-none">{data.total_score}</div>
                <div className="text-xs opacity-80 mt-1">{data.level}</div>
              </div>
            </div>

            {/* Radar chart */}
            <div className="flex-1 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis
                    dataKey="dimension"
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    axisLine={false}
                  />
                  <Radar
                    name="评分"
                    dataKey="score"
                    stroke="#6366f1"
                    fill="#6366f1"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Dimension list */}
          <div className="space-y-2">
            {data.dimensions.map((dim) => (
              <div
                key={dim.key}
                className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {/* Score bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{dim.label}</span>
                    <span className={`text-sm font-semibold ${dim.score >= 70 ? 'text-gray-600' : 'text-amber-600'}`}>
                      {dim.score}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        dim.score >= 90
                          ? 'bg-emerald-500'
                          : dim.score >= 70
                          ? 'bg-indigo-500'
                          : dim.score >= 50
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${dim.score}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{dim.detail}</p>
                </div>

                {/* Action button */}
                {dim.action && (
                  <button
                    onClick={() => handleAction(dim.action!)}
                    disabled={dim.action.route === '__action:build_kg' && buildingKG}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {dim.action.route === '__action:build_kg' && buildingKG ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <ArrowRight size={12} />
                    )}
                    {dim.action.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </WidgetContainer>
  )
}
```

---

### Task 5: Add Widget to DataInsights Page

**Files:**
- Modify: `frontend/src/pages/DataInsights.tsx`

- [ ] **Step 1: Import the widget**

Add import at top:
```typescript
import AssetScoreWidget from '../components/insights/AssetScoreWidget'
```

- [ ] **Step 2: Insert widget between stats cards and Todos**

After the stats cards grid (line ~145, after the closing `</div>` of the grid), before `<Todos embedded />`, add:

```tsx
{/* Asset Score Widget */}
<AssetScoreWidget />
```

- [ ] **Step 3: Commit frontend changes**

```bash
git add frontend/src/hooks/useWidgetConfig.ts frontend/src/components/insights/AssetScoreWidget.tsx frontend/src/pages/DataInsights.tsx
git commit -m "feat: add AssetScoreWidget with radar chart and actionable optimization buttons"
```

---

### Task 6: Verify Full Integration

- [ ] **Step 1: Start backend and verify API**

Run: `cd backend && uvicorn app.main:app --reload`
Then: `curl http://127.0.0.1:8000/api/assets/score -H "Authorization: Bearer <token>"`
Expected: JSON with total_score, level, dimensions

- [ ] **Step 2: Start frontend and verify widget**

Run: `cd frontend && npm run dev`
Open: http://localhost:5173/data-insights
Expected: Asset score widget visible below stat cards with radar chart

- [ ] **Step 3: Final commit if any fixes needed**
