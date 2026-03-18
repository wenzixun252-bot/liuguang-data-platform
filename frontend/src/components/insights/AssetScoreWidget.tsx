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

const LEVEL_BG: Record<string, string> = {
  '\u5353\u8d8a': 'from-emerald-500 to-emerald-600',
  '\u4f18\u79c0': 'from-indigo-500 to-purple-600',
  '\u826f\u597d': 'from-amber-500 to-amber-600',
  '\u5f85\u63d0\u5347': 'from-red-500 to-red-600',
}

export default function AssetScoreWidget({ onClose, compact }: { onClose?: () => void; compact?: boolean }) {
  const [data, setData] = useState<AssetScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buildingKG, setBuildingKG] = useState(false)
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

  const radarData =
    data?.dimensions.map((d) => ({
      dimension: d.label,
      score: d.score,
      fullMark: 100,
    })) || []

  const levelGradient = data ? (LEVEL_BG[data.level] || LEVEL_BG['\u826f\u597d']) : ''

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
          <div className={compact ? 'space-y-1' : 'space-y-2'}>
            {data.dimensions.map((dim) => (
              <div
                key={dim.key}
                className={`flex items-center gap-3 ${compact ? 'py-1 px-2' : 'py-2 px-3'} rounded-lg hover:bg-gray-50 transition-colors`}
              >
                {/* Score bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-700`}>{dim.label}</span>
                    <span
                      className={`${compact ? 'text-xs' : 'text-sm'} font-semibold ${dim.score >= 70 ? 'text-gray-600' : 'text-amber-600'}`}
                    >
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
                  {!compact && <p className="text-xs text-gray-400 mt-0.5">{dim.detail}</p>}
                </div>

                {/* Action button — hidden in compact mode */}
                {!compact && dim.action && (
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
