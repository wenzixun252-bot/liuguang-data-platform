import { useEffect, useState } from 'react'
import {
  CheckCircle,
  Clock,
  Send,
  Sparkles,
  X,
  Edit3,
  Check,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

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
  status: string
  feishu_task_id: string | null
  pushed_at: string | null
  created_at: string
  updated_at: string
}

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  pending_review: '待确认',
  confirmed: '已确认',
  pushed: '已推送',
  dismissed: '已驳回',
}

const TABS = [
  { key: 'pending_review', label: '待确认' },
  { key: 'confirmed', label: '已确认' },
  { key: 'pushed', label: '已推送' },
]

export default function Todos() {
  const [items, setItems] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [tab, setTab] = useState('pending_review')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [days, setDays] = useState(7)

  const fetchTodos = () => {
    setLoading(true)
    api
      .get('/todos', { params: { status: tab, page_size: 100 } })
      .then((res) => setItems(res.data.items))
      .catch(() => toast.error('加载待办失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchTodos()
    setSelected(new Set())
  }, [tab])

  const handleExtract = async () => {
    setExtracting(true)
    try {
      const res = await api.post('/todos/extract', { days })
      toast.success(`提取到 ${res.data.length} 条待办`)
      setTab('pending_review')
      fetchTodos()
    } catch {
      toast.error('提取待办失败')
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
    try {
      await api.patch(`/todos/${id}`, { title: editTitle })
      toast.success('已保存')
      setEditingId(null)
      fetchTodos()
    } catch {
      toast.error('保存失败')
    }
  }

  const handleBatchConfirm = async () => {
    if (selected.size === 0) return
    try {
      await api.post('/todos/batch-confirm', { ids: Array.from(selected) })
      toast.success(`已确认 ${selected.size} 条`)
      setSelected(new Set())
      fetchTodos()
    } catch {
      toast.error('批量确认失败')
    }
  }

  const handleBatchPush = async () => {
    if (selected.size === 0) return
    try {
      const res = await api.post('/todos/batch-push', { ids: Array.from(selected) })
      toast.success(`已推送 ${res.data.length} 条到飞书`)
      setSelected(new Set())
      fetchTodos()
    } catch {
      toast.error('批量推送失败')
    }
  }

  const handlePushSingle = async (id: number) => {
    try {
      await api.post(`/todos/${id}/push-feishu`)
      toast.success('已推送到飞书')
      fetchTodos()
    } catch {
      toast.error('推送失败')
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">智能待办</h1>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
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
      </div>

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
      {tab !== 'pushed' && items.length > 0 && (
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
              {tab === 'pending_review' && (
                <button
                  onClick={handleBatchConfirm}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 text-sm"
                >
                  <CheckCircle size={14} />
                  批量确认
                </button>
              )}
              <button
                onClick={handleBatchPush}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm"
              >
                <Send size={14} />
                批量推送飞书
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
          items.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 hover:shadow-md transition-shadow"
            >
              {tab !== 'pushed' && (
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="mt-1 rounded"
                />
              )}

              <div className="flex-1 min-w-0">
                {editingId === item.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveEdit(item.id)}
                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
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

                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${PRIORITY_COLORS[item.priority]}`}>
                    {item.priority === 'high' ? '高' : item.priority === 'medium' ? '中' : '低'}
                  </span>
                  <span className="text-xs text-gray-400">
                    来源: {item.source_type === 'meeting' ? '会议' : '聊天'}
                  </span>
                  {item.due_date && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(item.due_date).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                  {item.pushed_at && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle size={12} />
                      已推送 {new Date(item.pushed_at).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {tab === 'pending_review' && (
                  <>
                    <button
                      onClick={() => handleUpdateStatus(item.id, 'confirmed')}
                      className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                      title="确认"
                    >
                      <CheckCircle size={16} />
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(item.id, 'dismissed')}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"
                      title="驳回"
                    >
                      <X size={16} />
                    </button>
                  </>
                )}
                {(tab === 'pending_review' || tab === 'confirmed') && (
                  <>
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
                    <button
                      onClick={() => handlePushSingle(item.id)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="推送到飞书"
                    >
                      <Send size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
