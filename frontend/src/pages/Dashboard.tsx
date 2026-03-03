import { useEffect, useState } from 'react'
import { Database, FileText, Calendar, MessageSquare, TrendingUp, X, Search, Clock, Send, ArrowRight } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface AssetStats {
  total: number
  by_table: Record<string, number>
  recent_trend: { date: string; count: number }[]
}

interface DetailItem {
  id: number
  title?: string | null
  content_text?: string
  sender?: string | null
  created_at: string
}

interface TodoSummary {
  status_counts: Record<string, number>
  recent: {
    id: number
    title: string
    priority: string
    status: string
    due_date: string | null
    source_type: string
    created_at: string
  }[]
}

interface SearchResult {
  keyword: string
  entities: SearchItem[]
  data_items: SearchItem[]
  total: number
}

interface SearchItem {
  id: number
  title: string
  content_preview: string
  source_type: string
  created_at?: string | null
  entity_type?: string | null
  mention_count?: number | null
}

const TABLE_COLORS: Record<string, string> = {
  documents: '#6366f1',
  meetings: '#8b5cf6',
  chat_messages: '#a78bfa',
}

const TABLE_LABELS: Record<string, string> = {
  documents: '文档',
  meetings: '会议',
  chat_messages: '聊天记录',
}

const TABLE_ICONS: Record<string, React.ReactNode> = {
  documents: <FileText size={16} />,
  meetings: <Calendar size={16} />,
  chat_messages: <MessageSquare size={16} />,
}

const TABLE_ROUTES: Record<string, string> = {
  documents: '/documents',
  meetings: '/meetings',
  chat_messages: '/messages',
}

const TABLE_APIS: Record<string, string> = {
  documents: '/documents/list',
  meetings: '/meetings/list',
  chat_messages: '/chat-messages/list',
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  document: '文档',
  meeting: '会议',
  chat_message: '聊天',
  kg_entity: '知识图谱',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
}

export default function Dashboard() {
  const [stats, setStats] = useState<AssetStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailModal, setDetailModal] = useState<{ table: string; items: DetailItem[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [todoSummary, setTodoSummary] = useState<TodoSummary | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/assets/stats')
      .then((res) => setStats(res.data))
      .catch(() => toast.error('加载数据失败'))
      .finally(() => setLoading(false))

    api.get('/todos/summary')
      .then((res) => setTodoSummary(res.data))
      .catch(() => {}) // 静默失败
  }, [])

  const handleSearch = async () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true)
    try {
      const res = await api.get('/search', { params: { q } })
      setSearchResult(res.data)
    } catch {
      toast.error('搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const showDetail = async (table: string) => {
    const apiPath = TABLE_APIS[table]
    if (!apiPath) return
    setDetailLoading(true)
    try {
      const res = await api.get(apiPath, { params: { page: 1, page_size: 10 } })
      setDetailModal({ table, items: res.data.items })
    } catch {
      toast.error('加载明细失败')
    } finally {
      setDetailLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">数据看板</h1>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl p-6 shadow-sm animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-3" />
              <div className="h-8 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const pieData = stats
    ? Object.entries(stats.by_table).map(([key, value]) => ({
        name: TABLE_LABELS[key] || key,
        value,
        color: TABLE_COLORS[key] || '#d1d5db',
      }))
    : []

  const todoPending = todoSummary?.status_counts?.pending_review ?? 0
  const todoInProgress = todoSummary?.status_counts?.in_progress ?? 0

  return (
    <div className="space-y-6">
      {/* 标题 + 搜索栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">数据看板</h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索文档、会议、知识图谱..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </div>
      </div>

      {/* 搜索结果 */}
      {searchResult && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-700">
              搜索结果：「{searchResult.keyword}」共 {searchResult.total} 条
            </h2>
            <button onClick={() => setSearchResult(null)} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          {/* 知识图谱实体 */}
          {searchResult.entities.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">知识图谱实体</h3>
              <div className="flex flex-wrap gap-2">
                {searchResult.entities.map((e) => (
                  <span
                    key={e.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm cursor-pointer hover:bg-indigo-100"
                    onClick={() => navigate('/knowledge-graph')}
                  >
                    <span className="text-xs text-indigo-400">{e.entity_type}</span>
                    {e.title}
                    {e.mention_count && <span className="text-xs text-indigo-400">({e.mention_count})</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 数据结果 */}
          {searchResult.data_items.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">相关数据</h3>
              <div className="space-y-2">
                {searchResult.data_items.map((item) => (
                  <div
                    key={`${item.source_type}-${item.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      const route = TABLE_ROUTES[item.source_type + 's'] || TABLE_ROUTES[item.source_type + '_messages']
                      if (route) navigate(route)
                    }}
                  >
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 shrink-0 mt-0.5">
                      {SOURCE_TYPE_LABELS[item.source_type] || item.source_type}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.title}</p>
                      <p className="text-xs text-gray-400 truncate">{item.content_preview}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {searchResult.total === 0 && (
            <div className="py-6 text-center text-gray-400">未找到相关结果</div>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="数据总量"
          value={stats?.total ?? 0}
          icon={<Database className="text-indigo-500" size={20} />}
          color="bg-indigo-50"
        />
        {Object.entries(stats?.by_table || {}).map(([table, count]) => (
          <StatCard
            key={table}
            title={TABLE_LABELS[table] || table}
            value={count}
            icon={<span className="text-purple-500">{TABLE_ICONS[table]}</span>}
            color="bg-purple-50"
            onClick={() => showDetail(table)}
          />
        ))}
      </div>

      {/* 待办 + 图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 待办任务卡片 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">待办任务</h2>
            <button
              onClick={() => navigate('/todos')}
              className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              查看全部 <ArrowRight size={14} />
            </button>
          </div>

          {/* 状态统计 */}
          <div className="flex gap-3 mb-4">
            <div className="flex-1 bg-yellow-50 rounded-lg px-3 py-2 text-center">
              <p className="text-lg font-bold text-yellow-700">{todoPending}</p>
              <p className="text-xs text-yellow-600">待确认</p>
            </div>
            <div className="flex-1 bg-blue-50 rounded-lg px-3 py-2 text-center">
              <p className="text-lg font-bold text-blue-700">{todoInProgress}</p>
              <p className="text-xs text-blue-600">进行中</p>
            </div>
          </div>

          {/* 最近待办列表 */}
          {todoSummary?.recent && todoSummary.recent.length > 0 ? (
            <div className="space-y-2">
              {todoSummary.recent.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate('/todos')}
                >
                  {todo.status === 'in_progress' ? (
                    <Send size={14} className="text-blue-500 shrink-0" />
                  ) : (
                    <Clock size={14} className="text-yellow-500 shrink-0" />
                  )}
                  <span className="text-sm text-gray-700 truncate flex-1">{todo.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${PRIORITY_COLORS[todo.priority] || 'bg-gray-100 text-gray-500'}`}>
                    {todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-gray-400 text-sm">暂无待办</div>
          )}
        </div>

        {/* Pie chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">数据分布</h2>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} cursor="pointer" onClick={(_: unknown, index: number) => {
                  const keys = Object.keys(stats?.by_table || {})
                  if (keys[index]) showDetail(keys[index])
                }}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="暂无数据" />
          )}
        </div>

        {/* Trend chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            <TrendingUp size={18} className="inline mr-2" />
            近30天趋势
          </h2>
          {stats?.recent_trend && stats.recent_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.recent_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="暂无趋势数据" />
          )}
        </div>
      </div>

      {/* Detail modal */}
      {(detailModal || detailLoading) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">
                {detailModal ? `${TABLE_LABELS[detailModal.table] || detailModal.table}（最近10条）` : '加载中...'}
              </h2>
              <div className="flex items-center gap-2">
                {detailModal && (
                  <button
                    onClick={() => { setDetailModal(null); navigate(TABLE_ROUTES[detailModal.table] || '/') }}
                    className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-sm hover:bg-indigo-100"
                  >
                    查看全部
                  </button>
                )}
                <button onClick={() => setDetailModal(null)} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[60vh]">
              {detailLoading ? (
                <div className="p-8 text-center text-gray-400">加载中...</div>
              ) : detailModal && detailModal.items.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium w-12">#</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium">{detailModal.table === 'chat_messages' ? '发送人' : '标题'}</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium">内容摘要</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium w-40">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailModal.items.map((item, i) => (
                      <tr key={item.id} className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => { setDetailModal(null); navigate(TABLE_ROUTES[detailModal.table] || '/') }}>
                        <td className="py-3 px-4 text-gray-400">{i + 1}</td>
                        <td className="py-3 px-4 text-gray-800 font-medium truncate max-w-[200px]">
                          {detailModal.table === 'chat_messages' ? (item.sender || '未知') : (item.title || '无标题')}
                        </td>
                        <td className="py-3 px-4 text-gray-500 truncate max-w-[300px]">{(item.content_text || '').slice(0, 80)}</td>
                        <td className="py-3 px-4 text-gray-400 text-xs">{new Date(item.created_at).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-gray-400">暂无数据</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ title, value, icon, color, onClick }: { title: string; value: number; icon: React.ReactNode; color: string; onClick?: () => void }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm p-6 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-800">{value}</p>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-[200px] text-gray-400">
      {text}
    </div>
  )
}
