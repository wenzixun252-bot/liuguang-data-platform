import { useState, useEffect } from 'react'
import { Shield, ArrowRight, ChevronDown } from 'lucide-react'
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
import WidgetContainer from './WidgetContainer'

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

const LEVEL_BG: Record<string, string> = {
  '卓越': 'from-emerald-500 to-emerald-600',
  '优秀': 'from-indigo-500 to-purple-600',
  '良好': 'from-amber-500 to-amber-600',
  '待提升': 'from-red-500 to-red-600',
}

function scoreBarColor(score: number) {
  if (score >= 90) return 'bg-emerald-500'
  if (score >= 70) return 'bg-indigo-500'
  if (score >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

export default function AssetScoreWidget({ onClose, compact }: { onClose?: () => void; compact?: boolean }) {
  const [data, setData] = useState<AssetScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [chartReady, setChartReady] = useState(false)
  const navigate = useNavigate()

  useEffect(() => { requestAnimationFrame(() => setChartReady(true)) }, [])

  const fetchScore = () => {
    setLoading(true)
    setError(null)
    api
      .get('/assets/score')
      .then((res) => setData(res.data))
      .catch(() => setError('加载评分失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchScore() }, [])

  const handleAction = (action: ScoreAction) => {
    navigate(action.route)
  }

  const radarData =
    data?.dimensions.map((d) => ({
      dimension: d.label,
      score: d.score,
      fullMark: 100,
    })) || []

  const levelGradient = data ? (LEVEL_BG[data.level] || LEVEL_BG['良好']) : ''

  return (
    <WidgetContainer
      id="asset-score"
      title="数据评分"
      icon={<Shield size={20} />}
      loading={loading}
      error={error}
      onRetry={fetchScore}
      onClose={onClose}
    >
      {data && (
        <div className="space-y-5">
          {/* Score header */}
          <div className="flex items-center gap-4">
            {/* Big score circle */}
            <div
              className={`relative flex-shrink-0 ${compact ? 'w-20 h-20' : 'w-28 h-28'} rounded-full bg-gradient-to-br ${levelGradient} flex items-center justify-center shadow-lg`}
            >
              <div className="text-center text-white">
                <div className={`${compact ? 'text-2xl' : 'text-3xl'} font-bold leading-none`}>{data.total_score}</div>
                <div className="text-xs opacity-80 mt-1">{data.level}</div>
              </div>
            </div>

            {/* Radar chart */}
            <div className={`flex-1 min-w-0 relative ${compact ? 'h-36' : 'h-44'}`}>
              {chartReady && <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="dimension" tick={{ fill: '#6b7280', fontSize: compact ? 10 : 11 }} />
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
              </div>}
            </div>
          </div>

          {/* Dimension list */}
          <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
            {data.dimensions.map((dim) => (
              <div key={dim.key} className="rounded-lg hover:bg-gray-50/50 transition-colors">
                {/* Header row — clickable to expand */}
                <button
                  onClick={() => !compact && setExpandedKey(expandedKey === dim.key ? null : dim.key)}
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
                      <span
                        className={`${compact ? 'text-xs' : 'text-sm'} font-semibold ${dim.score >= 70 ? 'text-gray-600' : 'text-amber-600'}`}
                      >
                        {dim.score}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${scoreBarColor(dim.score)}`}
                        style={{ width: `${dim.score}%` }}
                      />
                    </div>
                    {!compact && <p className="text-[11px] text-gray-400 mt-0.5">{dim.detail}</p>}
                  </div>
                  {!compact && (
                    <ChevronDown
                      size={14}
                      className={`text-gray-300 shrink-0 transition-transform duration-200 ${expandedKey === dim.key ? 'rotate-180' : ''}`}
                    />
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
          </div>
        </div>
      )}
    </WidgetContainer>
  )
}
