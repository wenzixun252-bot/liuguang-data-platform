import { useEffect, useState } from 'react'
import { Heart, AlertTriangle, Lightbulb, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import WidgetContainer from './WidgetContainer'
import api from '../../lib/api'

interface CommunityInfo {
  community_id: number
  member_count: number
  top_entities: string[]
  label: string
}

interface InsightItem {
  title: string
  description: string
  type: 'insight' | 'risk'
  severity: 'high' | 'medium' | 'low'
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  high: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: '高风险' },
  medium: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', label: '中风险' },
  low: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: '低风险' },
}

const COMMUNITY_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
  'bg-purple-100 text-purple-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
]

export default function OrgHealthWidget({ onClose }: { onClose?: () => void }) {
  const [communities, setCommunities] = useState<CommunityInfo[]>([])
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [risks, setRisks] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = () => {
    setLoading(true)
    setError(null)
    setEmpty(false)
    Promise.allSettled([
      api.get('/knowledge-graph/communities'),
      api.get('/knowledge-graph/insights'),
      api.get('/knowledge-graph/risks'),
    ]).then(([commRes, insightRes, riskRes]) => {
      const comms = commRes.status === 'fulfilled' ? commRes.value.data : []
      const ins = insightRes.status === 'fulfilled' ? insightRes.value.data : []
      const rks = riskRes.status === 'fulfilled' ? riskRes.value.data : []

      if (comms.length === 0 && ins.length === 0 && rks.length === 0) {
        setEmpty(true)
      }
      setCommunities(comms)
      setInsights(ins)
      setRisks(rks)
    }).catch(() => setError('加载组织健康度数据失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetch() }, [])

  return (
    <WidgetContainer
      id="org-health"
      title="组织健康度"
      icon={<Heart size={20} />}
      loading={loading}
      error={error}
      onRetry={fetch}
      onClose={onClose}
    >
      {empty ? (
        <div className="text-center py-6 space-y-3">
          <p className="text-sm text-gray-400">尚未运行知识图谱分析</p>
          <Link
            to="/knowledge-graph"
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
          >
            前往知识图谱运行分析 <ExternalLink size={14} />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Communities */}
          {communities.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">社群概览</p>
              <div className="flex flex-wrap gap-2">
                {communities.map((c, i) => (
                  <span
                    key={c.community_id}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${COMMUNITY_COLORS[i % COMMUNITY_COLORS.length]}`}
                  >
                    {c.label} ({c.member_count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Risks */}
          {risks.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">风险警报</p>
              <div className="space-y-2">
                {risks.slice(0, 5).map((risk, idx) => {
                  const style = SEVERITY_STYLES[risk.severity] || SEVERITY_STYLES.medium
                  return (
                    <div key={idx} className={`${style.bg} border ${style.border} rounded-lg p-2.5`}>
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className={`${style.text} mt-0.5 shrink-0`} />
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${style.text}`}>{risk.title}</p>
                          <p className={`text-xs mt-0.5 opacity-80 ${style.text} truncate`}>{risk.description}</p>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${style.text} ${style.bg}`}>
                          {style.label}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Insights */}
          {insights.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">关键洞察</p>
              <div className="space-y-2">
                {insights.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                    <div className="flex items-start gap-2">
                      <Lightbulb size={14} className="text-blue-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-blue-800">{item.title}</p>
                        <p className="text-xs text-blue-600 mt-0.5 truncate">{item.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </WidgetContainer>
  )
}
