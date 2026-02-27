import { useEffect, useState } from 'react'
import {
  RefreshCw, Play, CheckCircle, XCircle, Clock, Loader2,
  Plus, Trash2, ToggleLeft, ToggleRight,
} from 'lucide-react'
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

interface DataSource {
  id: number
  app_token: string
  table_id: string
  table_name: string
  asset_type: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  success: { icon: <CheckCircle size={16} />, color: 'text-green-600 bg-green-50', label: '成功' },
  failed: { icon: <XCircle size={16} />, color: 'text-red-600 bg-red-50', label: '失败' },
  running: { icon: <Loader2 size={16} className="animate-spin" />, color: 'text-blue-600 bg-blue-50', label: '运行中' },
  idle: { icon: <Clock size={16} />, color: 'text-gray-600 bg-gray-50', label: '空闲' },
}

const ASSET_TYPES = [
  { value: 'conversation', label: '对话记录' },
  { value: 'meeting_note', label: '会议纪要' },
  { value: 'document', label: '文档' },
  { value: 'other', label: '其他' },
]

export default function ETLAdmin() {
  const [syncStates, setSyncStates] = useState<SyncState[]>([])
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  // 新建数据源表单
  const [form, setForm] = useState({
    app_token: '',
    table_id: '',
    table_name: '',
    asset_type: 'conversation',
  })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = () => {
    setLoading(true)
    Promise.all([
      api.get('/etl/status').catch(() => ({ data: [] })),
      api.get('/etl/sources').catch(() => ({ data: [] })),
    ])
      .then(([statusRes, sourcesRes]) => {
        setSyncStates(statusRes.data)
        setSources(sourcesRes.data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleTrigger = async () => {
    if (sources.filter(s => s.is_enabled).length === 0) {
      toast.error('没有已启用的数据源，请先添加')
      return
    }
    setTriggering(true)
    try {
      const res = await api.post('/etl/trigger')
      toast.success(`${res.data.message}，共 ${res.data.sources_count} 个数据源`)
      setTimeout(fetchData, 3000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '触发同步失败'
      toast.error(msg)
    } finally {
      setTriggering(false)
    }
  }

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.app_token.trim() || !form.table_id.trim()) {
      toast.error('请填写 App Token 和 Table ID')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/etl/sources', form)
      toast.success('数据源添加成功')
      setShowAddForm(false)
      setForm({ app_token: '', table_id: '', table_name: '', asset_type: 'conversation' })
      fetchData()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '添加失败'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (id: number, currentEnabled: boolean) => {
    try {
      await api.patch(`/etl/sources/${id}`, { is_enabled: !currentEnabled })
      toast.success(currentEnabled ? '已禁用' : '已启用')
      fetchData()
    } catch {
      toast.error('操作失败')
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确认删除数据源「${name || id}」？`)) return
    try {
      await api.delete(`/etl/sources/${id}`)
      toast.success('已删除')
      fetchData()
    } catch {
      toast.error('删除失败')
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

      {/* 数据源管理 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-700">数据源配置</h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Plus size={14} />
            添加数据源
          </button>
        </div>

        {/* 添加表单 */}
        {showAddForm && (
          <form onSubmit={handleAddSource} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
            <div className="text-sm font-medium text-gray-600 mb-2">
              添加飞书多维表格数据源
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">App Token *</label>
                <input
                  type="text"
                  value={form.app_token}
                  onChange={e => setForm({ ...form, app_token: e.target.value })}
                  placeholder="bascnXXXXXXXXXX"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Table ID *</label>
                <input
                  type="text"
                  value={form.table_id}
                  onChange={e => setForm({ ...form, table_id: e.target.value })}
                  placeholder="tblXXXXXXXXXX"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">表名称</label>
                <input
                  type="text"
                  value={form.table_name}
                  onChange={e => setForm({ ...form, table_name: e.target.value })}
                  placeholder="例如：客户对话记录"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">资产类型</label>
                <select
                  value={form.asset_type}
                  onChange={e => setForm({ ...form, asset_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none bg-white"
                >
                  {ASSET_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="text-xs text-gray-400">
              App Token 和 Table ID 可以从飞书多维表格的 URL 中获取：
              https://xxx.feishu.cn/base/<span className="text-indigo-500">APP_TOKEN</span>?table=<span className="text-indigo-500">TABLE_ID</span>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
              >
                {submitting ? '添加中...' : '确认添加'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
            </div>
          </form>
        )}

        {/* 数据源列表 */}
        {loading ? (
          <div className="text-center text-gray-400 py-8">加载中...</div>
        ) : sources.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">表名称</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">资产类型</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">App Token</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Table ID</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">状态</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="py-3 px-4 text-gray-800 font-medium">{s.table_name || '-'}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {ASSET_TYPES.find(t => t.value === s.asset_type)?.label || s.asset_type}
                    </td>
                    <td className="py-3 px-4 text-gray-500 font-mono text-xs">{s.app_token}</td>
                    <td className="py-3 px-4 text-gray-500 font-mono text-xs">{s.table_id}</td>
                    <td className="py-3 px-4">
                      {s.is_enabled ? (
                        <span className="text-green-600 text-xs bg-green-50 px-2 py-1 rounded-full">已启用</span>
                      ) : (
                        <span className="text-gray-400 text-xs bg-gray-100 px-2 py-1 rounded-full">已禁用</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggle(s.id, s.is_enabled)}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                          title={s.is_enabled ? '禁用' : '启用'}
                        >
                          {s.is_enabled
                            ? <ToggleRight size={18} className="text-green-500" />
                            : <ToggleLeft size={18} className="text-gray-400" />
                          }
                        </button>
                        <button
                          onClick={() => handleDelete(s.id, s.table_name)}
                          className="p-1 hover:bg-red-50 rounded transition-colors text-gray-400 hover:text-red-500"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-2">暂无数据源</div>
            <div className="text-sm text-gray-300">
              点击「添加数据源」配置飞书多维表格，然后触发同步抓取数据
            </div>
          </div>
        )}
      </div>

      {/* 同步状态 */}
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
    </div>
  )
}
