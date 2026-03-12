import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles,
  Loader2,
  ChevronRight,
  Calendar,
  MessageSquare,
  FileText,
  ArrowLeft,
  Search,
  Trash2,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface Candidate {
  user_id: string
  name: string
  meeting_count: number
  message_count: number
  document_count: number
  is_internal: boolean
}

interface InsightItem {
  id: number
  analyst_user_id: string
  target_user_id: string
  target_user_name: string
  report_markdown: string | null
  dimensions: Record<string, number>
  data_coverage: Record<string, number>
  generated_at: string
  created_at: string
}

const DIMENSION_LABELS: Record<string, string> = {
  communication: '沟通偏好',
  decision_making: '决策模式',
  focus_areas: '关注领域',
  meeting_habits: '会议习惯',
  responsiveness: '响应速度',
  collaboration_advice: '沟通建议',
}

export default function LeadershipInsight() {
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [activeInsight, setActiveInsight] = useState<InsightItem | null>(null)
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [insightSearch, setInsightSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const fetchInsights = (searchVal?: string) => {
    const params: Record<string, unknown> = { page_size: 50 }
    if (searchVal) params.search = searchVal

    Promise.all([
      api.get('/insights/leadership/candidates'),
      api.get('/insights/leadership', { params }),
    ])
      .then(([candRes, insightRes]) => {
        setCandidates(candRes.data)
        setInsights(insightRes.data.items)
      })
      .catch(() => toast.error('加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchInsights(insightSearch)
    setSelectedIds(new Set())
  }, [insightSearch])

  const handleGenerate = async (candidate: Candidate) => {
    setGeneratingId(candidate.user_id)
    try {
      const res = await api.post('/insights/leadership/generate', {
        target_user_id: candidate.user_id,
        target_user_name: candidate.name,
      })
      setActiveInsight(res.data)
      setInsights((prev) => [res.data, ...prev])
      setView('detail')
      toast.success('员工画像生成完成')
    } catch {
      toast.error('生成失败')
    } finally {
      setGeneratingId(null)
    }
  }

  const handleBatchDeleteInsights = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 条画像记录吗？`)) return
    try {
      const res = await api.post('/insights/leadership/batch-delete', { ids: Array.from(selectedIds) })
      toast.success(`已删除 ${res.data.deleted} 条`)
      setSelectedIds(new Set())
      fetchInsights(insightSearch)
    } catch {
      toast.error('批量删除失败')
    }
  }

  const getRadarData = (dimensions: Record<string, number>) => {
    return Object.entries(DIMENSION_LABELS).map(([key, label]) => ({
      dimension: label,
      score: dimensions[key] || 0,
      fullMark: 10,
    }))
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">加载中...</div>
  }

  if (view === 'detail' && activeInsight) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setView('list')
              setActiveInsight(null)
            }}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">
            {activeInsight.target_user_name} 的员工画像
          </h1>
        </div>

        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>生成于 {new Date(activeInsight.generated_at).toLocaleString('zh-CN')}</span>
          {activeInsight.data_coverage && (
            <>
              <span>会议 {activeInsight.data_coverage.meetings || 0} 条</span>
              <span>消息 {activeInsight.data_coverage.messages || 0} 条</span>
              <span>文档 {activeInsight.data_coverage.documents || 0} 条</span>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Radar Chart */}
          {Object.keys(activeInsight.dimensions).length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">多维评分</h3>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={getRadarData(activeInsight.dimensions)}>
                  <PolarGrid />
                  <PolarAngleAxis
                    dataKey="dimension"
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 10]}
                    tick={{ fontSize: 10 }}
                  />
                  <Radar
                    name="评分"
                    dataKey="score"
                    stroke="#6366f1"
                    fill="#6366f1"
                    fillOpacity={0.3}
                  />
                </RadarChart>
              </ResponsiveContainer>

              {/* Score list */}
              <div className="space-y-2 mt-4">
                {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                  const score = activeInsight.dimensions[key] || 0
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-sm text-gray-600 w-20">{label}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full transition-all"
                          style={{ width: `${(score / 10) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-8 text-right">
                        {score}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Report content */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-6">
            {activeInsight.report_markdown ? (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {activeInsight.report_markdown}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-center text-gray-400 py-12">暂无分析内容</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">员工画像</h1>

      {/* Candidates */}
      <div>
        <h2 className="text-lg font-semibold text-gray-700 mb-3">选择分析对象</h2>
        {candidates.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
            <p>暂无可分析的对象</p>
            <button
              type="button"
              onClick={() => navigate('/data-import')}
              className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
            >
              前往数据归档
            </button>
          </div>
        ) : (
          <>
            {/* 内部员工 */}
            {candidates.filter(c => c.is_internal).length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-500 mb-2">内部员工</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {candidates.filter(c => c.is_internal).slice(0, 12).map((c) => (
                    <CandidateCard key={c.user_id} candidate={c} generatingId={generatingId} onGenerate={handleGenerate} />
                  ))}
                </div>
              </div>
            )}
            {/* 外部人员 */}
            {candidates.filter(c => !c.is_internal).length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">外部人员</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {candidates.filter(c => !c.is_internal).slice(0, 12).map((c) => (
                    <CandidateCard key={c.user_id} candidate={c} generatingId={generatingId} onGenerate={handleGenerate} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Refresh button */}
      <div className="flex justify-end">
        <button
          onClick={() => { setLoading(true); fetchInsights(insightSearch) }}
          className="flex items-center gap-2 px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm"
        >
          <Search size={14} />
          刷新数据
        </button>
      </div>

      {/* History */}
      {(insights.length > 0 || insightSearch) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-700">历史画像</h2>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="搜索分析对象..."
                className="pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={insightSearch}
                onChange={(e) => setInsightSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Batch action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 mb-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 项</span>
              <button
                onClick={handleBatchDeleteInsights}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm"
              >
                <Trash2 size={14} />
                批量删除
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm"
              >
                取消选择
              </button>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {insights.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={insights.length > 0 && insights.every((i) => selectedIds.has(i.id))}
                        onChange={() => {
                          const allIds = insights.map((i) => i.id)
                          if (allIds.every((id) => selectedIds.has(id))) setSelectedIds(new Set())
                          else setSelectedIds(new Set(allIds))
                        }}
                        className="rounded"
                      />
                    </th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">分析对象</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">生成时间</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">数据覆盖</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.map((insight) => (
                    <tr
                      key={insight.id}
                      className={`border-t border-gray-50 hover:bg-indigo-50/50 transition-colors ${selectedIds.has(insight.id) ? 'bg-indigo-50/30' : ''}`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(insight.id)}
                          onChange={() => {
                            const next = new Set(selectedIds)
                            if (next.has(insight.id)) next.delete(insight.id)
                            else next.add(insight.id)
                            setSelectedIds(next)
                          }}
                          className="rounded"
                        />
                      </td>
                      <td className="py-3 px-4 font-medium text-gray-800">
                        {insight.target_user_name}
                      </td>
                      <td className="py-3 px-4 text-gray-500">
                        {new Date(insight.generated_at).toLocaleString('zh-CN')}
                      </td>
                      <td className="py-3 px-4 text-gray-500">
                        {insight.data_coverage
                          ? `会议${insight.data_coverage.meetings || 0} / 消息${insight.data_coverage.messages || 0} / 文档${insight.data_coverage.documents || 0}`
                          : '-'}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => {
                            setActiveInsight(insight)
                            setView('detail')
                          }}
                          className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          查看 <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-gray-400">没有匹配的画像记录</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  candidate: c,
  generatingId,
  onGenerate,
}: {
  candidate: Candidate
  generatingId: string | null
  onGenerate: (c: Candidate) => void
}) {
  const isGenerating = generatingId === c.user_id
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${c.is_internal ? 'bg-indigo-100' : 'bg-gray-100'}`}>
            <span className={`font-semibold ${c.is_internal ? 'text-indigo-700' : 'text-gray-600'}`}>{c.name[0]}</span>
          </div>
          <span className="font-medium text-gray-800">{c.name}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
        <span className="flex items-center gap-1">
          <Calendar size={12} /> {c.meeting_count}
        </span>
        <span className="flex items-center gap-1">
          <MessageSquare size={12} /> {c.message_count}
        </span>
        <span className="flex items-center gap-1">
          <FileText size={12} /> {c.document_count}
        </span>
      </div>

      <button
        onClick={() => onGenerate(c)}
        disabled={isGenerating || (generatingId !== null && !isGenerating)}
        className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm disabled:opacity-50"
      >
        {isGenerating ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Sparkles size={14} />
        )}
        {isGenerating ? '生成中...' : '生成画像'}
      </button>
    </div>
  )
}
