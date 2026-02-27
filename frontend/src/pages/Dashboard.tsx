import { useEffect, useState } from 'react'
import { Database, FileText, MessageSquare, TrendingUp } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface AssetStats {
  total: number
  by_type: Record<string, number>
  recent_trend: { date: string; count: number }[]
}

interface AssetItem {
  feishu_record_id: string
  title: string | null
  asset_type: string
  synced_at: string
}

const TYPE_COLORS: Record<string, string> = {
  conversation: '#6366f1',
  meeting_note: '#8b5cf6',
  document: '#a78bfa',
  other: '#c4b5fd',
}

const TYPE_LABELS: Record<string, string> = {
  conversation: '会话',
  meeting_note: '会议纪要',
  document: '文档',
  other: '其他',
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  conversation: <MessageSquare size={16} />,
  meeting_note: <FileText size={16} />,
  document: <Database size={16} />,
  other: <FileText size={16} />,
}

export default function Dashboard() {
  const [stats, setStats] = useState<AssetStats | null>(null)
  const [recentAssets, setRecentAssets] = useState<AssetItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/assets/stats').catch(() => ({ data: null })),
      api.get('/assets/list', { params: { page: 1, page_size: 10 } }).catch(() => ({ data: null })),
    ])
      .then(([statsRes, listRes]) => {
        if (statsRes.data) setStats(statsRes.data)
        if (listRes.data) setRecentAssets(listRes.data.items || [])
      })
      .catch(() => toast.error('加载数据失败'))
      .finally(() => setLoading(false))
  }, [])

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
    ? Object.entries(stats.by_type).map(([key, value]) => ({
        name: TYPE_LABELS[key] || key,
        value,
        color: TYPE_COLORS[key] || '#d1d5db',
      }))
    : []

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">数据看板</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="资产总数"
          value={stats?.total ?? 0}
          icon={<Database className="text-indigo-500" size={20} />}
          color="bg-indigo-50"
        />
        {Object.entries(stats?.by_type || {}).slice(0, 3).map(([type, count]) => (
          <StatCard
            key={type}
            title={TYPE_LABELS[type] || type}
            value={count}
            icon={<span className="text-purple-500">{TYPE_ICONS[type]}</span>}
            color="bg-purple-50"
          />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">资产类型分布</h2>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="暂无资产数据" />
          )}
        </div>

        {/* Trend chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            <TrendingUp size={18} className="inline mr-2" />
            近30天资产趋势
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

      {/* Recent assets table */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">最近同步的资产</h2>
        {recentAssets.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">标题</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">类型</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">同步时间</th>
                </tr>
              </thead>
              <tbody>
                {recentAssets.map((a) => (
                  <tr key={a.feishu_record_id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-2 text-gray-800">{a.title || '无标题'}</td>
                    <td className="py-3 px-2">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700">
                        {TYPE_LABELS[a.asset_type] || a.asset_type}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-gray-500">
                      {new Date(a.synced_at).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="暂无同步资产" />
        )}
      </div>
    </div>
  )
}

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
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
