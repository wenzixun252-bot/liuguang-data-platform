import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import WidgetContainer from './WidgetContainer'
import api from '../../lib/api'

interface TrendItem {
  date: string
  count: number
}

type Period = '7' | '30' | '90'

export default function TrendWidget({ onClose }: { onClose?: () => void }) {
  const [allTrend, setAllTrend] = useState<TrendItem[]>([])
  const [period, setPeriod] = useState<Period>('30')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartReady, setChartReady] = useState(false)

  useEffect(() => { requestAnimationFrame(() => setChartReady(true)) }, [])

  const fetch = () => {
    setLoading(true)
    setError(null)
    api.get('/assets/stats')
      .then((res) => setAllTrend(res.data.recent_trend || []))
      .catch(() => setError('加载趋势数据失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetch() }, [])

  const filteredTrend = allTrend.slice(-parseInt(period))

  return (
    <WidgetContainer
      id="trend"
      title="趋势分析"
      icon={<TrendingUp size={20} />}
      loading={loading}
      error={error}
      onRetry={fetch}
      onClose={onClose}
    >
      {/* Period tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {([['7', '7天'], ['30', '30天'], ['90', '90天']] as [Period, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setPeriod(val)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              period === val ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredTrend.length > 0 && chartReady ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={filteredTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
          暂无趋势数据
        </div>
      )}
    </WidgetContainer>
  )
}
