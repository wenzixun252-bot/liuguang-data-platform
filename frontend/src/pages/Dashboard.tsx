import { useEffect, useState } from 'react'
import { Database, FileText, Calendar, MessageSquare, TrendingUp, X } from 'lucide-react'
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

export default function Dashboard() {
  const [stats, setStats] = useState<AssetStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailModal, setDetailModal] = useState<{ table: string; items: DetailItem[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/assets/stats')
      .then((res) => setStats(res.data))
      .catch(() => toast.error('加载数据失败'))
      .finally(() => setLoading(false))
  }, [])

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">数据看板</h1>

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

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
