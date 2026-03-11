import { useState } from 'react'
import {
  Plus,
  FileText,
  Trash2,
  MoreHorizontal,
  Loader2,
  CheckCircle,
  AlertCircle,
  Send,
  ExternalLink,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../lib/api'
import toast from 'react-hot-toast'

export interface ReportItem {
  id: number
  title: string
  status: string
  content_markdown: string | null
  feishu_doc_url: string | null
  created_at: string
  time_range_start: string | null
  time_range_end: string | null
  target_readers: string[] | null
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', color: 'var(--color-text-quaternary)', icon: <FileText size={10} /> },
  generating: { label: '生成中', color: '#3b82f6', icon: <Loader2 size={10} className="animate-spin" /> },
  completed: { label: '已完成', color: '#22c55e', icon: <CheckCircle size={10} /> },
  failed: { label: '失败', color: '#ef4444', icon: <AlertCircle size={10} /> },
  published: { label: '已发布', color: '#8b5cf6', icon: <Send size={10} /> },
}

interface Props {
  reports: ReportItem[]
  activeId: number | null
  loading: boolean
  onSelect: (report: ReportItem) => void
  onNew: () => void
  onDeleted: (id: number) => void
}

export default function ReportSidebar({
  reports,
  activeId,
  loading,
  onSelect,
  onNew,
  onDeleted,
}: Props) {
  const [menuOpen, setMenuOpen] = useState<number | null>(null)

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这份报告吗？')) return
    try {
      await api.post('/reports/batch-delete', { ids: [id] })
      onDeleted(id)
      toast.success('已删除')
    } catch {
      toast.error('删除失败')
    }
    setMenuOpen(null)
  }

  return (
    <div
      className="w-[272px] border-r border-black/[0.04] flex flex-col h-full"
      style={{ background: 'var(--glass-bg-sidebar)' }}
    >
      {/* 新建按钮 */}
      <div className="p-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[var(--color-accent)] text-white rounded-xl hover:bg-[var(--color-accent-hover)] transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          新建报告
        </motion.button>
      </div>

      {/* 报告列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-quaternary)' }} />
          </div>
        ) : reports.length === 0 ? (
          <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-quaternary)' }}>
            暂无报告
          </p>
        ) : (
          reports.map((report) => {
            const cfg = STATUS_CFG[report.status] || STATUS_CFG.draft
            return (
              <div
                key={report.id}
                className={`group relative px-3 py-2.5 cursor-pointer transition-colors rounded-xl mx-2 mb-0.5 ${
                  activeId === report.id
                    ? 'bg-[var(--color-accent-subtle)]'
                    : 'hover:bg-black/[0.03]'
                }`}
                onClick={() => onSelect(report)}
              >
                {activeId === report.id && (
                  <motion.div
                    layoutId="active-report-indicator"
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[var(--color-accent)]"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <div className="flex items-start gap-2 pl-2">
                  <FileText
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color: cfg.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm truncate"
                      style={{
                        color: activeId === report.id
                          ? 'var(--color-accent)'
                          : 'var(--color-text-primary)',
                      }}
                    >
                      {report.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px]"
                        style={{ color: cfg.color }}
                      >
                        {cfg.icon}
                        {cfg.label}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-quaternary)' }}>
                        {new Date(report.created_at).toLocaleDateString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {report.feishu_doc_url && (
                        <a
                          href={report.feishu_doc_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5"
                        >
                          <ExternalLink size={8} />
                        </a>
                      )}
                    </div>
                  </div>
                  {/* 更多操作 */}
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/[0.06] rounded-lg transition-all"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(menuOpen === report.id ? null : report.id)
                    }}
                    title="更多操作"
                  >
                    <MoreHorizontal size={14} style={{ color: 'var(--color-text-quaternary)' }} />
                  </button>
                </div>

                {/* 下拉菜单 */}
                <AnimatePresence>
                  {menuOpen === report.id && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.92, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -2 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute right-2 top-10 z-10 apple-glass-heavy rounded-xl py-1.5 min-w-[140px]"
                      style={{ boxShadow: 'var(--shadow-float)' }}
                    >
                      <button
                        type="button"
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(report.id)
                        }}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
