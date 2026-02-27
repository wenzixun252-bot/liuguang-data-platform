import { useEffect, useState } from 'react'
import { RefreshCw, Play, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface SyncState {
  source_app_token: string
  source_table_id: string
  last_sync_time: string
  last_sync_status: string
  records_synced: number
  error_message: string | null
}

interface RegistryEntry {
  app_token: string
  table_id: string
  table_name: string
  asset_type: string
  is_enabled: boolean
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  success: { icon: <CheckCircle size={16} />, color: 'text-green-600 bg-green-50', label: '成功' },
  failed: { icon: <XCircle size={16} />, color: 'text-red-600 bg-red-50', label: '失败' },
  running: { icon: <Loader2 size={16} className="animate-spin" />, color: 'text-blue-600 bg-blue-50', label: '运行中' },
  idle: { icon: <Clock size={16} />, color: 'text-gray-600 bg-gray-50', label: '空闲' },
}

export default function ETLAdmin() {
  const [syncStates, setSyncStates] = useState<SyncState[]>([])
  const [registry, setRegistry] = useState<RegistryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)

  const fetchData = () => {
    setLoading(true)
    Promise.all([
      api.get('/etl/status').catch(() => ({ data: [] })),
      api.get('/etl/registry').catch(() => ({ data: [] })),
    ])
      .then(([statusRes, registryRes]) => {
        setSyncStates(statusRes.data)
        setRegistry(registryRes.data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleTrigger = async () => {
    setTriggering(true)
    try {
      await api.post('/etl/trigger')
      toast.success('ETL 同步任务已触发')
      // Refresh after a short delay
      setTimeout(fetchData, 2000)
    } catch {
      toast.error('触发同步失败')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">ETL 管理</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            刷新
          </button>
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            手动触发同步
          </button>
        </div>
      </div>

      {/* Sync Status */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">同步状态</h2>
        {loading ? (
          <div className="text-center text-gray-400 py-8">加载中...</div>
        ) : syncStates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">应用 Token</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">表 ID</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">状态</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">同步记录数</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">最后同步</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">错误</th>
                </tr>
              </thead>
              <tbody>
                {syncStates.map((s, i) => {
                  const cfg = STATUS_CONFIG[s.last_sync_status] || STATUS_CONFIG.idle
                  return (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-3 px-4 text-gray-800 font-mono text-xs">{s.source_app_token}</td>
                      <td className="py-3 px-4 text-gray-600 font-mono text-xs">{s.source_table_id}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${cfg.color}`}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-700">{s.records_synced}</td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                        {new Date(s.last_sync_time).toLocaleString('zh-CN')}
                      </td>
                      <td className="py-3 px-4 text-red-500 text-xs max-w-xs truncate">
                        {s.error_message || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-8">暂无同步记录</div>
        )}
      </div>

      {/* Registry */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">注册中心</h2>
        {registry.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">表名称</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">资产类型</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">应用 Token</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">表 ID</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">启用</th>
                </tr>
              </thead>
              <tbody>
                {registry.map((r, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="py-3 px-4 text-gray-800 font-medium">{r.table_name}</td>
                    <td className="py-3 px-4 text-gray-600">{r.asset_type}</td>
                    <td className="py-3 px-4 text-gray-500 font-mono text-xs">{r.app_token}</td>
                    <td className="py-3 px-4 text-gray-500 font-mono text-xs">{r.table_id}</td>
                    <td className="py-3 px-4">
                      {r.is_enabled ? (
                        <span className="text-green-600 text-xs bg-green-50 px-2 py-1 rounded-full">已启用</span>
                      ) : (
                        <span className="text-gray-400 text-xs bg-gray-50 px-2 py-1 rounded-full">已禁用</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-8">注册中心为空</div>
        )}
      </div>
    </div>
  )
}
