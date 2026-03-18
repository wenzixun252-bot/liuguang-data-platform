import { useState, useEffect, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, MessageSquare, Table2, X, TrendingUp, Loader2, ArrowUpRight, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../lib/api'
import toast from 'react-hot-toast'
import Todos from './Todos'
import AssetScoreWidget from '../components/insights/AssetScoreWidget'

const KnowledgeGraph = lazy(() => import('./KnowledgeGraph'))

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
  summary?: string | null
  initiator?: string | null
  comm_type?: string
  file_type?: string | null
  source_url?: string | null
  bitable_url?: string | null
  row_count?: number | null
  column_count?: number | null
  created_at: string
}

const DETAIL_ROUTES: Record<string, string> = {
  documents: '/documents',
  communications: '/communications',
  tables: '/structured-tables',
}

const CARD_CONFIG = [
  {
    key: 'documents',
    label: '文档',
    icon: FileText,
    gradient: 'from-slate-800 via-[#1e3a5f] to-[#2d4a7a]',
    shadow: 'shadow-[0_8px_30px_rgba(30,58,95,0.4)]',
    api: '/documents/list',
  },
  {
    key: 'communications',
    label: '沟通',
    icon: MessageSquare,
    gradient: 'from-slate-800 via-[#3b1e5c] to-[#4c2882]',
    shadow: 'shadow-[0_8px_30px_rgba(59,30,92,0.4)]',
    api: '/communications/list',
  },
  {
    key: 'tables',
    label: '表格',
    icon: Table2,
    gradient: 'from-slate-800 via-[#1e4a3b] to-[#286b52]',
    shadow: 'shadow-[0_8px_30px_rgba(30,74,59,0.4)]',
    api: '/structured-tables',
  },
]

export default function DataInsights() {
  const navigate = useNavigate()
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
  const [commTab, setCommTab] = useState<'meeting' | 'chat'>('meeting')

  // 加载统计数据
  useEffect(() => {
    api.get('/assets/stats')
      .then((res) => setStats(res.data))
      .catch(() => toast.error('加载统计数据失败'))
      .finally(() => setStatsLoading(false))
  }, [])

  // Escape 键关闭弹窗
  useEffect(() => {
    if (!detailModal) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailModal(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [detailModal])

  // 弹窗加载数据
  const showDetail = async (card: typeof CARD_CONFIG[0], mode: 'all' | 'today') => {
    setCommTab('meeting')
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)', letterSpacing: 'var(--tracking-tighter)' }}>
          数据洞察中心
        </h1>
      </div>

      <>
      {/* 数据卡片区 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
        {statsLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl p-6 h-28 apple-skeleton" />
          ))
        ) : (
          CARD_CONFIG.map((card) => {
            const Icon = card.icon
            const total = stats?.by_table[card.key] ?? 0
            const todayNew = stats?.today_new[card.key] ?? 0
            return (
              <motion.div
                key={card.key}
                whileHover={{ y: -3, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={`rounded-2xl p-6 bg-gradient-to-br ${card.gradient} ${card.shadow} text-white cursor-pointer`}
                onClick={() => showDetail(card, 'all')}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-[10px] bg-white/10 flex items-center justify-center">
                      <Icon size={18} className="opacity-90" />
                    </div>
                    <span className="text-sm font-medium opacity-85">{card.label}</span>
                  </div>
                  {todayNew > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); showDetail(card, 'today') }}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white/15 hover:bg-white/25 rounded-full text-xs font-medium transition-colors"
                    >
                      <TrendingUp size={12} />
                      今日+{todayNew}
                    </button>
                  )}
                </div>
                <div className="text-3xl font-bold tracking-tight">
                  {total}
                </div>
              </motion.div>
            )
          })
        )}
      </div>

      {/* 数据评分 + 智能待办 并排 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AssetScoreWidget />
        <Todos embedded />
      </div>

      {/* 数据图谱（完整知识图谱） */}
      <Suspense fallback={
        <div className="apple-card p-8 flex flex-col items-center justify-center h-64">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-200 border-t-indigo-500 animate-spin mb-3" />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)', animation: 'apple-breathe 2s ease-in-out infinite' }}>
            加载数据图谱...
          </p>
        </div>
      }>
        <KnowledgeGraph embedded />
      </Suspense>

      {/* 数据明细弹窗（全量 or 今日新增） */}
      <AnimatePresence mode="wait">
        {detailModal && (
          <motion.div
            key="detail-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setDetailModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 5 }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              className="bg-white rounded-2xl w-full max-w-5xl max-h-[80vh] overflow-hidden"
              style={{ boxShadow: 'var(--shadow-float)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 头部：标题 + 跳转 + 关闭 */}
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {detailModal.label}{detailModal.mode === 'today' ? ' — 今日新增' : ' — 数据概览'}
                  </h2>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => { setDetailModal(null); navigate(DETAIL_ROUTES[detailModal.key] || '/') }}
                      className="p-1.5 hover:bg-black/[0.04] rounded-lg transition-colors apple-btn"
                      title="前往详情页"
                    >
                      <ArrowUpRight size={18} style={{ color: 'var(--color-text-tertiary)' }} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailModal(null)}
                      className="p-1.5 hover:bg-black/[0.04] rounded-lg transition-colors apple-btn"
                      title="关闭"
                    >
                      <X size={18} style={{ color: 'var(--color-text-tertiary)' }} />
                    </button>
                  </div>
                </div>
                {/* 沟通 Tab 切换器 */}
                {detailModal.key === 'communications' && !detailLoading && (
                  <div className="flex items-center gap-1 mt-3 p-1 rounded-lg w-fit" style={{ background: 'var(--color-bg-secondary, #f3f4f6)' }}>
                    {([
                      { value: 'meeting' as const, label: '会议', count: detailModal.items.filter(i => i.comm_type === 'meeting' || i.comm_type === 'recording').length },
                      { value: 'chat' as const, label: '会话', count: detailModal.items.filter(i => i.comm_type === 'chat').length },
                    ]).map(tab => (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => setCommTab(tab.value)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          commTab === tab.value
                            ? 'bg-white shadow-sm text-gray-900'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {tab.label}
                        <span className={`ml-1.5 text-xs ${commTab === tab.value ? 'text-indigo-600' : 'text-gray-400'}`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* 表格内容 */}
              <div className="overflow-y-auto max-h-[60vh]">
                {detailLoading ? (
                  <div className="flex items-center justify-center p-12" style={{ color: 'var(--color-text-tertiary)' }}>
                    <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
                  </div>
                ) : (() => {
                  // 根据卡片类型和 commTab 过滤数据
                  const displayItems = detailModal.key === 'communications'
                    ? detailModal.items.filter(i =>
                        commTab === 'meeting'
                          ? (i.comm_type === 'meeting' || i.comm_type === 'recording')
                          : i.comm_type === 'chat'
                      )
                    : detailModal.items

                  if (displayItems.length === 0) {
                    return (
                      <div className="p-12 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                        {detailModal.mode === 'today' ? '今日暂无新增数据' : '暂无数据'}
                      </div>
                    )
                  }

                  const thClass = "text-left py-3 px-4 font-medium"
                  const thStyle = { color: 'var(--color-text-tertiary)' } as const
                  const tdClass = "py-3 px-4"

                  return (
                    <table className="w-full text-sm table-fixed">
                      <thead className="sticky top-0" style={{ background: 'var(--color-bg-primary)' }}>
                        {detailModal.key === 'documents' ? (
                          <tr>
                            <th className={`${thClass} w-10`} style={thStyle}>#</th>
                            <th className={`${thClass} w-[30%]`} style={thStyle}>标题</th>
                            <th className={`${thClass} w-16`} style={thStyle}>类型</th>
                            <th className={thClass} style={thStyle}>摘要</th>
                            <th className={`${thClass} w-40`} style={thStyle}>时间</th>
                            <th className={`${thClass} w-12`} style={thStyle}>操作</th>
                          </tr>
                        ) : detailModal.key === 'communications' ? (
                          <tr>
                            <th className={`${thClass} w-10`} style={thStyle}>#</th>
                            <th className={`${thClass} w-[30%]`} style={thStyle}>{commTab === 'meeting' ? '会议标题' : '发送者'}</th>
                            <th className={thClass} style={thStyle}>摘要</th>
                            <th className={`${thClass} w-40`} style={thStyle}>时间</th>
                            <th className={`${thClass} w-12`} style={thStyle}>操作</th>
                          </tr>
                        ) : (
                          <tr>
                            <th className={`${thClass} w-10`} style={thStyle}>#</th>
                            <th className={thClass} style={thStyle}>表名</th>
                            <th className={`${thClass} w-20`} style={thStyle}>记录数</th>
                            <th className={`${thClass} w-20`} style={thStyle}>字段数</th>
                            <th className={`${thClass} w-40`} style={thStyle}>时间</th>
                            <th className={`${thClass} w-12`} style={thStyle}>操作</th>
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {displayItems.map((item, i) => {
                          const linkUrl = item.source_url || item.bitable_url
                          return (
                            <tr key={item.id} className="border-t border-black/[0.04] hover:bg-black/[0.02] transition-colors">
                              <td className={tdClass} style={{ color: 'var(--color-text-quaternary)' }}>{i + 1}</td>
                              {detailModal.key === 'documents' ? (
                                <>
                                  <td className={`${tdClass} font-medium truncate`} style={{ color: 'var(--color-text-primary)' }} title={item.title || item.name || '无标题'}>
                                    {item.title || item.name || '无标题'}
                                  </td>
                                  <td className={tdClass} style={{ color: 'var(--color-text-secondary)' }}>
                                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{item.file_type || '-'}</span>
                                  </td>
                                  <td className={`${tdClass} truncate`} style={{ color: 'var(--color-text-secondary)' }} title={(item.summary || item.content_text || '')}>
                                    {(item.summary || item.content_text || '').slice(0, 120)}
                                  </td>
                                </>
                              ) : detailModal.key === 'communications' ? (
                                <>
                                  <td className={`${tdClass} font-medium truncate`} style={{ color: 'var(--color-text-primary)' }} title={commTab === 'meeting' ? (item.title || '无标题') : (item.initiator || '未知')}>
                                    {commTab === 'meeting' ? (item.title || '无标题') : (item.initiator || '未知')}
                                  </td>
                                  <td className={`${tdClass} truncate`} style={{ color: 'var(--color-text-secondary)' }} title={(item.summary || item.content_text || '')}>
                                    {(item.summary || item.content_text || '').slice(0, 150)}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className={`${tdClass} font-medium truncate`} style={{ color: 'var(--color-text-primary)' }} title={item.name || item.title || '无标题'}>
                                    {item.name || item.title || '无标题'}
                                  </td>
                                  <td className={`${tdClass} text-center`} style={{ color: 'var(--color-text-secondary)' }}>
                                    {item.row_count ?? '-'}
                                  </td>
                                  <td className={`${tdClass} text-center`} style={{ color: 'var(--color-text-secondary)' }}>
                                    {item.column_count ?? '-'}
                                  </td>
                                </>
                              )}
                              <td className={`${tdClass} text-xs`} style={{ color: 'var(--color-text-quaternary)' }}>
                                {new Date(item.created_at).toLocaleString('zh-CN')}
                              </td>
                              <td className={tdClass}>
                                {linkUrl ? (
                                  <a
                                    href={linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 hover:bg-black/[0.04] rounded-lg transition-colors inline-flex"
                                    title="查看源文件"
                                  >
                                    <ExternalLink size={14} className="text-indigo-500" />
                                  </a>
                                ) : (
                                  <span className="p-1.5 inline-flex">
                                    <ExternalLink size={14} className="text-gray-300" />
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </>
    </div>
  )
}
