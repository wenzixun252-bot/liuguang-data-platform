import { useEffect, useState } from 'react'
import {
  RefreshCw, Play, CheckCircle, XCircle, Clock, Loader2,
  Plus, Trash2, ToggleLeft, ToggleRight, Search,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { TagSelector } from '../components/TagManager'

interface DataSourceWithSync {
  id: number
  app_token: string
  table_id: string
  table_name: string
  asset_type: string
  owner_id: string | null
  owner_name: string | null
  default_tag_ids: number[]
  is_enabled: boolean
  created_at: string
  updated_at: string
  last_sync_status: string | null
  last_sync_time: string | null
  records_synced: number | null
  error_message: string | null
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  success: { icon: <CheckCircle size={14} />, color: 'text-green-600 bg-green-50', label: '成功' },
  failed: { icon: <XCircle size={14} />, color: 'text-red-600 bg-red-50', label: '失败' },
  running: { icon: <Loader2 size={14} className="animate-spin" />, color: 'text-blue-600 bg-blue-50', label: '运行中' },
  idle: { icon: <Clock size={14} />, color: 'text-gray-600 bg-gray-50', label: '空闲' },
}

const ASSET_TYPES = [
  { value: 'document', label: '文档' },
  { value: 'communication', label: '沟通记录' },
]

export default function ETLAdmin() {
  const [sources, setSources] = useState<DataSourceWithSync[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const [form, setForm] = useState({
    app_token: '',
    table_id: '',
    table_name: '',
    asset_type: 'document',
  })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = () => {
    setLoading(true)
    api.get('/etl/sources-with-status')
      .then((res) => setSources(res.data))
      .catch(() => toast.error('加载数据源失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [search])

  // 前端搜索过滤
  const filtered = search
    ? sources.filter((s) =>
        (s.table_name || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.asset_type || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.owner_name || '').toLowerCase().includes(search.toLowerCase())
      )
    : sources

  const currentIds = filtered.map((s) => s.id)
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id))

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(currentIds))
  }

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个数据源吗？`)) return
    try {
      const res = await api.post('/etl/sources/batch-delete', { ids: Array.from(selectedIds) })
      toast.success(`已删除 ${res.data.deleted} 个`)
      setSelectedIds(new Set())
      fetchData()
    } catch {
      toast.error('批量删除失败')
    }
  }

  const [syncPolling, setSyncPolling] = useState(false)

  // 同步轮询（useEffect 管理，组件卸载自动清理）
  useEffect(() => {
    if (!syncPolling) return
    const timer = setInterval(() => {
      api.get('/etl/sources-with-status').then((r) => {
        setSources(r.data)
        const anyRunning = r.data.some((s: DataSourceWithSync) => s.last_sync_status === 'running')
        if (!anyRunning) {
          setSyncPolling(false)
          toast.success('同步完成')
        }
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [syncPolling])

  // 页面加载时检查是否有正在运行的同步
  useEffect(() => {
    api.get('/etl/sources-with-status').then((r) => {
      const anyRunning = r.data.some((s: DataSourceWithSync) => s.last_sync_status === 'running')
      if (anyRunning) {
        setSources(r.data)
        setSyncPolling(true)
      }
    }).catch(() => {})
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
      setSyncPolling(true)
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
      setForm({ app_token: '', table_id: '', table_name: '', asset_type: 'document' })
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

      {/* 添加数据源 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-700">数据源管理</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="搜索数据源..."
                className="pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <Plus size={14} />
              添加数据源
            </button>
          </div>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddSource} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
            <div className="text-sm font-medium text-gray-600 mb-2">添加飞书多维表格数据源</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">App Token *</label>
                <input type="text" value={form.app_token} onChange={e => setForm({ ...form, app_token: e.target.value })} placeholder="bascnXXXXXXXXXX" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Table ID *</label>
                <input type="text" value={form.table_id} onChange={e => setForm({ ...form, table_id: e.target.value })} placeholder="tblXXXXXXXXXX" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">表名称</label>
                <input type="text" value={form.table_name} onChange={e => setForm({ ...form, table_name: e.target.value })} placeholder="例如：客户对话记录" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">资产类型</label>
                <select value={form.asset_type} onChange={e => setForm({ ...form, asset_type: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none bg-white">
                  {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={submitting} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">{submitting ? '添加中...' : '确认添加'}</button>
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
            </div>
          </form>
        )}

        {/* Batch action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 mb-4 bg-indigo-50 border border-indigo-200 rounded-lg">
            <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 个</span>
            <button
              onClick={handleBatchDelete}
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

        {/* 合并的数据源 + 同步状态表 */}
        {loading ? (
          <div className="text-center text-gray-400 py-8">加载中...</div>
        ) : filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-3 px-4 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded" />
                  </th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">表名称</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium hidden md:table-cell">添加人</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium hidden lg:table-cell">默认标签</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">启用</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">同步状态</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium hidden md:table-cell">记录数</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium hidden lg:table-cell">最后同步</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium hidden lg:table-cell">错误</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const syncCfg = STATUS_CONFIG[s.last_sync_status || ''] || null
                  return (
                    <tr key={s.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${selectedIds.has(s.id) ? 'bg-indigo-50/30' : ''}`}>
                      <td className="py-3 px-4">
                        <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} className="rounded" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-gray-800 font-medium">{s.table_name || '-'}</div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5">{s.app_token.slice(0, 12)}.../{s.table_id}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700">
                          {ASSET_TYPES.find(t => t.value === s.asset_type)?.label || s.asset_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 hidden md:table-cell">{s.owner_name || '-'}</td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <TagSelector
                          selected={s.default_tag_ids || []}
                          onChange={async (ids) => {
                            try {
                              await api.patch(`/etl/sources/${s.id}/tags`, { default_tag_ids: ids })
                              fetchData()
                            } catch { toast.error('更新标签失败') }
                          }}
                        />
                      </td>
                      <td className="py-3 px-4">
                        {s.is_enabled ? (
                          <span className="text-green-600 text-xs bg-green-50 px-2 py-1 rounded-full">已启用</span>
                        ) : (
                          <span className="text-gray-400 text-xs bg-gray-100 px-2 py-1 rounded-full">已禁用</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {syncCfg ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${syncCfg.color}`}>
                            {syncCfg.icon}
                            {syncCfg.label}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">未同步</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-700 hidden md:table-cell">{s.records_synced || 0}</td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap hidden lg:table-cell">
                        {s.last_sync_time ? new Date(s.last_sync_time).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className="py-3 px-4 text-red-500 text-xs max-w-[200px] truncate hidden lg:table-cell" title={s.error_message || ''}>
                        {s.error_message || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleToggle(s.id, s.is_enabled)} className="p-1 hover:bg-gray-100 rounded" title={s.is_enabled ? '禁用' : '启用'}>
                            {s.is_enabled ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} className="text-gray-400" />}
                          </button>
                          <button onClick={() => handleDelete(s.id, s.table_name)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500" title="删除">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-2">{search ? '没有匹配的数据源' : '暂无数据源'}</div>
            {!search && <div className="text-sm text-gray-300">点击「添加数据源」配置飞书多维表格，或由用户在「数据导入」页面添加</div>}
          </div>
        )}
      </div>
    </div>
  )
}
