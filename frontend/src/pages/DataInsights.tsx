import { useState, useEffect, lazy, Suspense } from 'react'
import { FileText, MessageSquare, Table2, X, TrendingUp, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../lib/api'
import toast from 'react-hot-toast'
import Todos from './Todos'

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
  initiator?: string | null
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
    key: 'communications',
    label: '沟通',
    icon: MessageSquare,
    color: 'from-purple-500 to-purple-600',
    api: '/communications/list',
  },
  {
    key: 'tables',
    label: '表格',
    icon: Table2,
    color: 'from-amber-500 to-amber-600',
    api: '/structured-tables/list',
  },
]

export default function DataInsights() {
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

  // 加载统计数据
  useEffect(() => {
    api.get('/assets/stats')
      .then((res) => setStats(res.data))
      .catch(() => toast.error('加载统计数据失败'))
      .finally(() => setStatsLoading(false))
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
                className={`rounded-2xl p-6 bg-gradient-to-br ${card.color} text-white cursor-pointer`}
                style={{ boxShadow: 'var(--shadow-lg)' }}
                onClick={() => showDetail(card, 'all')}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon size={20} className="opacity-80" />
                    <span className="text-sm font-medium opacity-90">{card.label}</span>
                  </div>
                  {todayNew > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); showDetail(card, 'today') }}
                      className="flex items-center gap-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded-full text-xs font-medium transition-colors apple-btn"
                    >
                      <TrendingUp size={12} />
                      今日+{todayNew}
                    </button>
                  )}
                </div>
                <div className="text-3xl font-bold">
                  {total}
                </div>
              </motion.div>
            )
          })
        )}
      </div>

      {/* 智能待办（嵌入模式，带分页） */}
      <Todos embedded />

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
      <AnimatePresence>
        {detailModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setDetailModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 5 }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
              style={{ boxShadow: 'var(--shadow-float)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.06]">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {detailModal.label}{detailModal.mode === 'today' ? ' — 今日新增' : ' — 数据概览'}
                </h2>
                <button
                  type="button"
                  onClick={() => setDetailModal(null)}
                  className="p-1.5 hover:bg-black/[0.04] rounded-lg transition-colors apple-btn"
                  title="关闭"
                >
                  <X size={18} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              </div>
              <div className="overflow-y-auto max-h-[60vh]">
                {detailLoading ? (
                  <div className="flex items-center justify-center p-12" style={{ color: 'var(--color-text-tertiary)' }}>
                    <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
                  </div>
                ) : detailModal.items.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0" style={{ background: 'var(--color-bg-primary)' }}>
                      <tr>
                        <th className="text-left py-3 px-4 font-medium w-12" style={{ color: 'var(--color-text-tertiary)' }}>#</th>
                        <th className="text-left py-3 px-4 font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
                          {detailModal.key === 'communications' ? '组织者/发送者' : '标题'}
                        </th>
                        <th className="text-left py-3 px-4 font-medium" style={{ color: 'var(--color-text-tertiary)' }}>内容摘要</th>
                        <th className="text-left py-3 px-4 font-medium w-40" style={{ color: 'var(--color-text-tertiary)' }}>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailModal.items.map((item, i) => (
                        <tr key={item.id} className="border-t border-black/[0.04] hover:bg-black/[0.02] transition-colors">
                          <td className="py-3 px-4" style={{ color: 'var(--color-text-quaternary)' }}>{i + 1}</td>
                          <td className="py-3 px-4 font-medium truncate max-w-[200px]" style={{ color: 'var(--color-text-primary)' }}>
                            {detailModal.key === 'communications'
                              ? (item.initiator || '未知')
                              : (item.title || item.name || '无标题')}
                          </td>
                          <td className="py-3 px-4 truncate max-w-[300px]" style={{ color: 'var(--color-text-secondary)' }}>
                            {(item.content_text || '').slice(0, 80)}
                          </td>
                          <td className="py-3 px-4 text-xs" style={{ color: 'var(--color-text-quaternary)' }}>
                            {new Date(item.created_at).toLocaleString('zh-CN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-12 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                    {detailModal.mode === 'today' ? '今日暂无新增数据' : '暂无数据'}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </>
    </div>
  )
}
