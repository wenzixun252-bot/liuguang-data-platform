import { useState } from 'react'
import {
  Plus,
  MessageSquare,
  Trash2,
  Download,
  Send,
  MoreHorizontal,
  Loader2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../lib/api'
import toast from 'react-hot-toast'

export interface ConversationItem {
  id: number
  title: string
  scene: string
  created_at: string
  updated_at: string
}

interface Props {
  conversations: ConversationItem[]
  activeId: number | null
  loading: boolean
  onSelect: (id: number) => void
  onNew: () => void
  onDeleted: (id: number) => void
}

export default function ChatSidebar({
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onDeleted,
}: Props) {
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这个对话吗？')) return
    try {
      await api.delete(`/conversations/${id}`)
      onDeleted(id)
      toast.success('已删除')
    } catch {
      toast.error('删除失败')
    }
    setMenuOpen(null)
  }

  const handleExport = async (id: number) => {
    setExporting(true)
    try {
      const res = await api.get(`/conversations/${id}/export`)
      const blob = new Blob([res.data.markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${res.data.title}.md`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('已导出')
    } catch {
      toast.error('导出失败')
    }
    setExporting(false)
    setMenuOpen(null)
  }

  const handlePushFeishu = async (id: number) => {
    try {
      const res = await api.post(`/conversations/${id}/push-feishu`)
      toast.success('已推送到飞书')
      if (res.data.url) {
        window.open(res.data.url, '_blank')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '推送失败')
    }
    setMenuOpen(null)
  }

  return (
    <div className="w-[272px] border-r border-black/[0.04] flex flex-col h-full"
         style={{ background: 'var(--glass-bg-sidebar)' }}>
      {/* 新建按钮 */}
      <div className="p-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[var(--color-accent)] text-white rounded-xl hover:bg-[var(--color-accent-hover)] transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          新建对话
        </motion.button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-quaternary)' }} />
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-quaternary)' }}>暂无对话</p>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group relative px-3 py-2.5 cursor-pointer transition-colors rounded-xl mx-2 mb-0.5 ${
                activeId === conv.id
                  ? 'bg-[var(--color-accent-subtle)]'
                  : 'hover:bg-black/[0.03]'
              }`}
              onClick={() => onSelect(conv.id)}
            >
              {/* 活跃会话指示器 */}
              {activeId === conv.id && (
                <motion.div
                  layoutId="active-conv-indicator"
                  className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[var(--color-accent)]"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <div className="flex items-start gap-2 pl-2">
                <MessageSquare size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--color-text-quaternary)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: activeId === conv.id ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                    {conv.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-quaternary)' }}>
                    {new Date(conv.updated_at).toLocaleDateString()}
                  </p>
                </div>
                {/* 更多操作 */}
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/[0.06] rounded-lg transition-all apple-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(menuOpen === conv.id ? null : conv.id)
                  }}
                  title="更多操作"
                >
                  <MoreHorizontal size={14} style={{ color: 'var(--color-text-quaternary)' }} />
                </button>
              </div>

              {/* 下拉菜单 */}
              <AnimatePresence>
                {menuOpen === conv.id && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="absolute right-2 top-10 z-10 apple-glass-heavy rounded-xl py-1.5 min-w-[160px]"
                    style={{ boxShadow: 'var(--shadow-float)' }}
                  >
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-black/[0.04] transition-colors apple-btn"
                      style={{ color: 'var(--color-text-primary)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleExport(conv.id)
                      }}
                      disabled={exporting}
                    >
                      <Download size={14} />
                      导出 Markdown
                    </button>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-black/[0.04] transition-colors apple-btn"
                      style={{ color: 'var(--color-text-primary)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        handlePushFeishu(conv.id)
                      }}
                    >
                      <Send size={14} />
                      推送飞书文档
                    </button>
                    <div className="border-t border-black/[0.06] my-1 mx-2" />
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors apple-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(conv.id)
                      }}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
