import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Settings, FileText, Calendar, MessageSquare, Table2, X, TrendingUp,
  CheckSquare, Clock, AlertCircle, Loader2,
} from 'lucide-react'
import { useWidgetConfig } from '../hooks/useWidgetConfig'

import DataGraphWidget from '../components/insights/DataGraphWidget'
import TrendWidget from '../components/insights/TrendWidget'
import WidgetConfigModal from '../components/insights/WidgetConfigModal'
import type { WidgetId } from '../hooks/useWidgetConfig'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface AssetStats {
  total: number
  by_table: Record<string, number>
  today_new: Record<string, number>
  recent_trend: { date: string; count: number }[]
}

interface DetailItem {
  id: number
  title?: string | null
  name?: string | null
  content_text?: string
  sender?: string | null
  created_at: string
}

interface TodoItem {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  due_date: string | null
  source_type: string | null
  created_at: string
}

const CARD_CONFIG = [
  {
    key: 'documents',
    label: '文档',
    icon: FileText,
    color: 'from-blue-500 to-blue-600',
    api: '/documents/list',
  },
  {
    key: 'meetings',
    label: '会议',
    icon: Calendar,
    color: 'from-purple-500 to-purple-600',
    api: '/meetings/list',
  },
  {
    key: 'chat_messages',
    label: '聊天',
    icon: MessageSquare,
    color: 'from-emerald-500 to-emerald-600',
    api: '/chat-messages/list',
  },
  {
    key: 'tables',
    label: '表格',
    icon: Table2,
    color: 'from-amber-500 to-amber-600',
    api: '/structured-tables/list',
  },
]

const PRIORITY_STYLES: Record<string, string> = {
  high: 'text-red-600 bg-red-50',
  medium: 'text-orange-600 bg-orange-50',
  low: 'text-blue-600 bg-blue-50',
}

export default function DataInsights() {
  const navigate = useNavigate()

  const { configs, enabledConfigs, toggleWidget, moveWidget, resetToDefault } = useWidgetConfig()
  const [showConfig, setShowConfig] = useState(false)
  const [stats, setStats] = useState<AssetStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  // 弹窗：全量数据 or 今日新增
  const [detailModal, setDetailModal] = useState<{
    key: string
    label: string
    mode: 'all' | 'today'
    items: DetailItem[]
  } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [widgetRefreshKey] = useState(0)
  // 待办
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [todosLoading, setTodosLoading] = useState(true)

  // 加载统计数据
  useEffect(() => {
    api.get('/assets/stats')
      .then((res) => setStats(res.data))
      .catch(() => toast.error('加载统计数据失败'))
      .finally(() => setStatsLoading(false))
  }, [])

  // 加载待办（只要待确认和进行中的）
  useEffect(() => {
    Promise.allSettled([
      api.get('/todos', { params: { status: 'pending_review', page_size: 10 } }),
      api.get('/todos', { params: { status: 'in_progress', page_size: 10 } }),
    ]).then(([prRes, ipRes]) => {
      const pending = prRes.status === 'fulfilled' ? prRes.value.data.items || [] : []
      const inProgress = ipRes.status === 'fulfilled' ? ipRes.value.data.items || [] : []
      setTodos([...pending, ...inProgress])
    }).finally(() => setTodosLoading(false))
  }, [])

  // 弹窗加载数据
  const showDetail = async (card: typeof CARD_CONFIG[0], mode: 'all' | 'today') => {
    setDetailLoading(true)
    setDetailModal({ key: card.key, label: card.label, mode, items: [] })
    try {
      const res = await api.get(card.api, { params: { page: 1, page_size: 50 } })
      let items: DetailItem[] = res.data.items || []
      // 今日模式：前端过滤只保留今天创建的
      if (mode === 'today') {
        const todayStr = new Date().toISOString().split('T')[0]
        items = items.filter((item) => item.created_at?.startsWith(todayStr))
      }
      setDetailModal({ key: card.key, label: card.label, mode, items })
    } catch {
      toast.error('加载明细失败')
      setDetailModal(null)
    } finally {
      setDetailLoading(false)
    }
  }

  // 更新待办状态
  const updateTodoStatus = async (id: number, newStatus: string) => {
    try {
      await api.patch(`/todos/${id}`, { status: newStatus })
      setTodos(prev => prev.filter(t => t.id !== id))
      toast.success(newStatus === 'completed' ? '已完成' : '状态已更新')
    } catch {
      toast.error('操作失败')
    }
  }

  const renderWidget = (id: WidgetId) => {
    const onClose = () => toggleWidget(id)
    switch (id) {
      case 'data-graph':
        return <DataGraphWidget key={`dg-${widgetRefreshKey}`} onClose={onClose} />
      case 'trend':
        return <TrendWidget onClose={onClose} />
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">数据洞察中心</h1>
        <button
          onClick={() => setShowConfig(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Settings size={16} />
          配置面板
        </button>
      </div>

      <>
      {/* 数据卡片区 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl p-5 bg-gray-200 animate-pulse h-24" />
          ))
        ) : (
          CARD_CONFIG.map((card) => {
            const Icon = card.icon
            const total = stats?.by_table[card.key] ?? 0
            const todayNew = stats?.today_new[card.key] ?? 0
            return (
              <div
                key={card.key}
                className={`rounded-xl p-5 bg-gradient-to-br ${card.color} text-white shadow-sm hover:shadow-md transition-shadow`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon size={20} className="opacity-80" />
                    <span className="text-sm font-medium opacity-90">{card.label}</span>
                  </div>
                  {todayNew > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); showDetail(card, 'today') }}
                      className="flex items-center gap-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded-full text-xs font-medium transition-colors"
                    >
                      <TrendingUp size={12} />
                      今日+{todayNew}
                    </button>
                  )}
                </div>
                <div
                  className="text-3xl font-bold cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => showDetail(card, 'all')}
                >
                  {total}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 待办任务区 */}
      {!todosLoading && todos.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckSquare size={18} className="text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-800">待办事项</h2>
            <span className="text-xs text-gray-400 ml-1">{todos.length} 项待处理</span>
            <button
              type="button"
              onClick={() => navigate('/chat?tab=todos')}
              className="ml-auto text-xs text-indigo-600 hover:text-indigo-800"
            >
              查看全部
            </button>
          </div>
          <div className="space-y-2">
            {todos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-lg group">
                {/* 状态图标 */}
                {todo.status === 'pending_review' ? (
                  <AlertCircle size={16} className="text-orange-500 shrink-0" />
                ) : (
                  <Clock size={16} className="text-blue-500 shrink-0" />
                )}
                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{todo.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      todo.status === 'pending_review' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                    }`}>
                      {todo.status === 'pending_review' ? '待确认' : '进行中'}
                    </span>
                    {todo.priority && (
                      <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_STYLES[todo.priority] || 'text-gray-500 bg-gray-100'}`}>
                        {todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}
                      </span>
                    )}
                    {todo.due_date && (
                      <span className="text-xs text-gray-400">
                        截止 {new Date(todo.due_date).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                  </div>
                </div>
                {/* 操作 */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {todo.status === 'pending_review' && (
                    <button
                      onClick={() => updateTodoStatus(todo.id, 'in_progress')}
                      className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100"
                    >
                      确认
                    </button>
                  )}
                  {todo.status === 'in_progress' && (
                    <button
                      onClick={() => updateTodoStatus(todo.id, 'completed')}
                      className="px-2 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100"
                    >
                      完成
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Widgets grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {enabledConfigs.map((config) => (
          <div key={config.id}>
            {renderWidget(config.id)}
          </div>
        ))}
      </div>

      {enabledConfigs.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="mb-3">没有启用的组件</p>
          <button
            onClick={() => setShowConfig(true)}
            className="text-indigo-600 hover:text-indigo-800 text-sm"
          >
            点击配置面板添加组件
          </button>
        </div>
      )}

      {/* Config modal */}
      {showConfig && (
        <WidgetConfigModal
          configs={configs}
          onToggle={toggleWidget}
          onMove={moveWidget}
          onReset={resetToDefault}
          onClose={() => setShowConfig(false)}
        />
      )}

      {/* 数据明细弹窗（全量 or 今日新增） */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">
                {detailModal.label}{detailModal.mode === 'today' ? ' — 今日新增' : ' — 数据概览'}
              </h2>
              <button onClick={() => setDetailModal(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[60vh]">
              {detailLoading ? (
                <div className="flex items-center justify-center p-12 text-gray-400">
                  <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
                </div>
              ) : detailModal.items.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium w-12">#</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium">
                        {detailModal.key === 'chat_messages' ? '发送人' : '标题'}
                      </th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium">内容摘要</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium w-40">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailModal.items.map((item, i) => (
                      <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-400">{i + 1}</td>
                        <td className="py-3 px-4 text-gray-800 font-medium truncate max-w-[200px]">
                          {detailModal.key === 'chat_messages'
                            ? (item.sender || '未知')
                            : (item.title || item.name || '无标题')}
                        </td>
                        <td className="py-3 px-4 text-gray-500 truncate max-w-[300px]">
                          {(item.content_text || '').slice(0, 80)}
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-xs">
                          {new Date(item.created_at).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center text-gray-400">
                  {detailModal.mode === 'today' ? '今日暂无新增数据' : '暂无数据'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </>
    </div>
  )
}
