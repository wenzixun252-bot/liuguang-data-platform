import { useEffect, useState } from 'react'
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Sparkles,
  X,
  Edit3,
  Check,
  Search,
  Trash2,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import api from '../lib/api'
import { DateRangeFilter } from '../components/DateRangeFilter'
import toast from 'react-hot-toast'
import { useTaskProgress } from '../hooks/useTaskProgress'
import WidgetContainer from '../components/insights/WidgetContainer'

interface TodoItem {
  id: number
  owner_id: string
  title: string
  description: string | null
  due_date: string | null
  priority: 'low' | 'medium' | 'high'
  source_type: string
  source_id: number | null
  source_text: string | null
  source_time: string | null
  source_comm_type: string | null
  status: string
  confidence: number | null
  created_at: string
  updated_at: string
}

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-orange-100 text-orange-700',
  high: 'bg-red-100 text-red-700',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: '不急',
  medium: '较急',
  high: '紧急',
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: '进行中',
  completed: '已完成',
}

const TABS = [
  { key: 'in_progress', label: '进行中' },
  { key: 'completed', label: '已完成' },
]

const getImportanceLabel = (confidence: number | null): { text: string; className: string } => {
  const c = confidence ?? 0.5
  if (c >= 0.9) return { text: '非常重要', className: 'bg-red-100 text-red-700' }
  if (c >= 0.7) return { text: '比较重要', className: 'bg-orange-100 text-orange-700' }
  if (c >= 0.5) return { text: '一般', className: 'bg-blue-100 text-blue-600' }
  return { text: '参考', className: 'bg-gray-100 text-gray-500' }
}

interface SourceDetail {
  id: number
  title: string | null
  comm_type: string
  comm_time: string | null
  initiator: string | null
  participants: (string | { name?: string; open_id?: string })[]
  content_text: string
  summary: string | null
  conclusions: string | null
  action_items: (string | Record<string, unknown>)[]
  keywords: string[]
  source_url: string | null
  bitable_url: string | null
  created_at: string
}

export default function Todos({ embedded = false }: { embedded?: boolean } = {}) {
  const { addTask, updateTask } = useTaskProgress()
  const PAGE_SIZE = embedded ? 5 : 20
  const [items, setItems] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [tab, setTab] = useState('in_progress')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [days, setDays] = useState(2)
  const [search, setSearch] = useState('')
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({})
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [sourceModal, setSourceModal] = useState<{ open: boolean; loading: boolean; data: SourceDetail | null }>({
    open: false,
    loading: false,
    data: null,
  })
  const [savingId, setSavingId] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchTodos = () => {
    setLoading(true)
    const params: Record<string, unknown> = { status: tab, page_size: PAGE_SIZE, page }
    if (search) params.search = search
    for (const [field, range] of Object.entries(dateFilters)) {
      if (range.from || range.to) {
        params.date_field = field
        if (range.from) params.date_from = range.from + 'T00:00:00'
        if (range.to) params.date_to = range.to + 'T23:59:59'
        break
      }
    }
    api
      .get('/todos', { params })
      .then((res) => {
        setItems(res.data.items || [])
        setTotal(res.data.total ?? (res.data.items || []).length)
      })
      .catch(() => toast.error('加载待办失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [tab, search, dateFilters])

  useEffect(() => {
    fetchTodos()
    setSelected(new Set())
  }, [tab, search, dateFilters, page])

  // Escape 键关闭弹窗
  useEffect(() => {
    if (!sourceModal.open && !deleteConfirm) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteConfirm) setDeleteConfirm(false)
        else if (sourceModal.open) setSourceModal({ open: false, loading: false, data: null })
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [sourceModal.open, deleteConfirm])

  const handleExtract = async () => {
    if (extracting) return
    setExtracting(true)
    const taskId = 'todo-extract'
    addTask(taskId, '智能提取待办', '/chat?tab=todos')
    updateTask(taskId, { message: '正在分析数据...' })
    try {
      await api.post('/todos/extract', { days })
      const poll = async (): Promise<number> => {
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const statusRes = await api.get('/todos/extract-status')
          const st = statusRes.data
          if (st.status === 'done') return st.count ?? 0
          if (st.status === 'error') throw new Error(st.message || '提取失败')
          updateTask(taskId, { message: st.message || '提取中...' })
        }
        throw new Error('提取超时')
      }
      const count = await poll()
      updateTask(taskId, { status: 'done', progress: 100, message: `提取到 ${count} 条` })
      toast.success(`提取到 ${count} 条待办`)
      setTab('in_progress')
      fetchTodos()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '未知错误'
      updateTask(taskId, { status: 'error', progress: 100, message: '提取失败', errorDetail: detail })
      toast.error(`提取待办失败: ${detail}`)
    } finally {
      setExtracting(false)
    }
  }

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/todos/${id}`, { status })
      toast.success('已更新')
      fetchTodos()
    } catch {
      toast.error('更新失败')
    }
  }

  const handleSaveEdit = async (id: number) => {
    setSavingId(id)
    try {
      await api.patch(`/todos/${id}`, { title: editTitle })
      toast.success('已保存')
      setEditingId(null)
      fetchTodos()
    } catch {
      toast.error('保存失败')
    } finally {
      setSavingId(null)
    }
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    setDeleteConfirm(true)
  }

  const confirmBatchDelete = async () => {
    setDeleteConfirm(false)
    try {
      const res = await api.post('/todos/batch-delete', { ids: Array.from(selected) })
      toast.success(`已删除 ${res.data.deleted} 条`)
      setSelected(new Set())
      fetchTodos()
    } catch {
      toast.error('批量删除失败')
    }
  }

  const handleBatchStatus = async (status: string) => {
    if (selected.size === 0) return
    try {
      await api.post('/todos/batch-status', { ids: Array.from(selected), status })
      toast.success(`已更新 ${selected.size} 条`)
      setSelected(new Set())
      fetchTodos()
    } catch {
      toast.error('批量操作失败')
    }
  }

  const handleViewSource = async (sourceId: number) => {
    setSourceModal({ open: true, loading: true, data: null })
    try {
      const res = await api.get(`/communications/${sourceId}`)
      setSourceModal({ open: true, loading: false, data: res.data })
    } catch {
      toast.error('加载来源详情失败')
      setSourceModal({ open: false, loading: false, data: null })
    }
  }

  const toggleSelect = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const toggleSelectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((i) => i.id)))
    }
  }

  const updateDateFilter = (field: string, from: string, to: string) => {
    setDateFilters((prev) => {
      const next = { ...prev }
      if (!from && !to) delete next[field]
      else next[field] = { from, to }
      return next
    })
    setPage(1)
  }

  const toolbarContent = (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="搜索待办..."
          className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!embedded && (
        <>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>创建时间</span>
            <DateRangeFilter from={dateFilters.created_at?.from || ''} to={dateFilters.created_at?.to || ''} onChange={(f, t) => updateDateFilter('created_at', f, t)} />
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>截止日期</span>
            <DateRangeFilter from={dateFilters.due_date?.from || ''} to={dateFilters.due_date?.to || ''} onChange={(f, t) => updateDateFilter('due_date', f, t)} />
          </div>
        </>
      )}
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
      >
        <option value={2}>近 2 天</option>
        <option value={3}>近 3 天</option>
        <option value={7}>近 7 天</option>
        <option value={14}>近 14 天</option>
        <option value={30}>近 30 天</option>
      </select>
      <button
        onClick={handleExtract}
        disabled={extracting}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
      >
        <Sparkles size={16} />
        {extracting ? '提取中...' : '智能提取待办'}
      </button>
    </div>
  )

  const innerContent = (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-800">智能待办</h1>
          {toolbarContent}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Batch actions */}
      {items.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === items.length && items.length > 0}
              onChange={toggleSelectAll}
              className="rounded"
            />
            全选
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-sm text-gray-400">已选 {selected.size} 条</span>
              {tab === 'in_progress' && (
                <button
                  onClick={() => handleBatchStatus('completed')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 text-sm"
                >
                  <CheckCircle size={14} />
                  批量完成
                </button>
              )}
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm"
              >
                <Trash2 size={14} />
                批量删除
              </button>
            </>
          )}
        </div>
      )}

      {/* Todo list */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">加载中...</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
            暂无{STATUS_LABELS[tab]}的待办
          </div>
        ) : (
          items.map((item) => {
            const importance = getImportanceLabel(item.confidence)
            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 hover:shadow-md transition-shadow ${embedded ? 'border border-gray-100' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="mt-1 rounded"
                />

                <div className="flex-1 min-w-0">
                  {editingId === item.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !savingId) handleSaveEdit(item.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        disabled={savingId === item.id}
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm disabled:opacity-50"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveEdit(item.id)}
                        disabled={savingId === item.id}
                        className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                      >
                        {savingId === item.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={savingId === item.id}
                        className="p-1 text-gray-400 hover:bg-gray-100 rounded disabled:opacity-50"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-gray-800">{item.title}</p>
                  )}

                  {item.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>
                  )}

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${importance.className}`}>
                      {importance.text}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[item.priority]}`}>
                      {PRIORITY_LABELS[item.priority] || item.priority}
                    </span>
                    {item.source_id ? (
                      <button
                        onClick={() => handleViewSource(item.source_id!)}
                        className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline transition-colors"
                      >
                        来源: {item.source_comm_type === 'chat' ? '会话记录' : '会议录音'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">
                        来源: {item.source_comm_type === 'chat' ? '会话记录' : '会议录音'}
                      </span>
                    )}
                    {item.source_time && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock size={12} />
                        {new Date(item.source_time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {item.due_date && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock size={12} />
                        截止 {new Date(item.due_date).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {tab === 'in_progress' && (
                    <>
                      <button
                        onClick={() => handleUpdateStatus(item.id, 'completed')}
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                        title="标记完成"
                      >
                        <CheckCircle size={16} />
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(item.id)
                          setEditTitle(item.title)
                        }}
                        className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"
                        title="编辑"
                      >
                        <Edit3 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-gray-400">共 {total} 条</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | 'dot')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('dot')
                acc.push(p)
                return acc
              }, [])
              .map((p, idx) =>
                p === 'dot' ? (
                  <span key={`dot-${idx}`} className="px-1 text-xs text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`min-w-[28px] h-7 rounded-lg text-xs font-medium transition-colors ${
                      page === p
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-800 mb-2">确认删除</h3>
            <p className="text-sm text-gray-500 mb-5">确定要删除选中的 {selected.size} 条待办吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={confirmBatchDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 来源详情弹窗 */}
      {sourceModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSourceModal({ open: false, loading: false, data: null })}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">来源详情</h3>
              <button
                type="button"
                title="关闭"
                onClick={() => setSourceModal({ open: false, loading: false, data: null })}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {sourceModal.loading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 size={24} className="animate-spin mr-2" />
                  加载中...
                </div>
              ) : sourceModal.data ? (
                <div className="space-y-4">
                  {sourceModal.data.title && (
                    <div>
                      <span className="text-xs font-medium text-gray-400">标题</span>
                      <p className="text-sm text-gray-800 mt-0.5">{sourceModal.data.title}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs font-medium text-gray-400">类型</span>
                      <p className="text-sm text-gray-700 mt-0.5">{sourceModal.data.comm_type}</p>
                    </div>
                    {sourceModal.data.comm_time && (
                      <div>
                        <span className="text-xs font-medium text-gray-400">时间</span>
                        <p className="text-sm text-gray-700 mt-0.5">
                          {new Date(sourceModal.data.comm_time).toLocaleString('zh-CN')}
                        </p>
                      </div>
                    )}
                    {sourceModal.data.initiator && (
                      <div>
                        <span className="text-xs font-medium text-gray-400">发起人</span>
                        <p className="text-sm text-gray-700 mt-0.5">{sourceModal.data.initiator}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-medium text-gray-400">创建时间</span>
                      <p className="text-sm text-gray-700 mt-0.5">
                        {new Date(sourceModal.data.created_at).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>

                  {sourceModal.data.participants.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-gray-400">参与人</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {sourceModal.data.participants.map((p, i) => (
                          <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">
                            {typeof p === 'string' ? p : (p?.name || '未知')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {sourceModal.data.summary && (
                    <div>
                      <span className="text-xs font-medium text-gray-400">摘要</span>
                      <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{sourceModal.data.summary}</p>
                    </div>
                  )}

                  {sourceModal.data.conclusions && (
                    <div>
                      <span className="text-xs font-medium text-gray-400">结论</span>
                      <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{sourceModal.data.conclusions}</p>
                    </div>
                  )}

                  {sourceModal.data.action_items.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-gray-400">待办事项</span>
                      <ul className="mt-1 space-y-1">
                        {sourceModal.data.action_items.map((a, i) => {
                          let task = '', assignee = ''
                          if (typeof a === 'string') {
                            try {
                              const parsed = JSON.parse(a)
                              task = parsed.task || parsed.content || parsed.text || a
                              assignee = parsed.assignee || ''
                            } catch { task = a }
                          } else {
                            const obj = a as Record<string, unknown>
                            task = String(obj.task || obj.content || obj.text || JSON.stringify(a))
                            assignee = String(obj.assignee || '')
                          }
                          return (
                            <li key={i} className="text-sm text-gray-700 flex items-start gap-1.5">
                              <span className="text-indigo-400 mt-0.5">•</span>
                              <span>{task}{assignee && <span className="ml-1.5 text-xs text-gray-400">— {assignee}</span>}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  <div>
                    <span className="text-xs font-medium text-gray-400">原文内容</span>
                    <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap max-h-40 overflow-y-auto bg-gray-50 rounded-lg p-3">
                      {sourceModal.data.content_text}
                    </p>
                  </div>

                  {sourceModal.data.keywords.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-gray-400">关键词</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {sourceModal.data.keywords.map((k, i) => (
                          <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {sourceModal.data.bitable_url && (
                    <a
                      href={sourceModal.data.bitable_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                    >
                      <ExternalLink size={12} />
                      在飞书多维表格中查看
                    </a>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (embedded) {
    return (
      <WidgetContainer
        id="smart-todos"
        title="智能待办"
        icon={<Sparkles size={20} />}
        headerExtra={toolbarContent}
      >
        <div className="-mt-1">{innerContent}</div>
      </WidgetContainer>
    )
  }

  return innerContent
}
