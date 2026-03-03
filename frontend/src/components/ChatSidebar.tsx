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
    <div className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col h-full">
      {/* 新建按钮 */}
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
        >
          <Plus size={16} />
          新建对话
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">暂无对话</p>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group relative px-3 py-2.5 cursor-pointer hover:bg-gray-100 transition-colors ${
                activeId === conv.id ? 'bg-indigo-50 border-r-2 border-indigo-600' : ''
              }`}
              onClick={() => onSelect(conv.id)}
            >
              <div className="flex items-start gap-2">
                <MessageSquare size={14} className="mt-0.5 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{conv.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(conv.updated_at).toLocaleDateString()}
                  </p>
                </div>
                {/* 更多操作 */}
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-all"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(menuOpen === conv.id ? null : conv.id)
                  }}
                >
                  <MoreHorizontal size={14} className="text-gray-400" />
                </button>
              </div>

              {/* 下拉菜单 */}
              {menuOpen === conv.id && (
                <div className="absolute right-2 top-10 z-10 bg-white shadow-lg rounded-lg border border-gray-200 py-1 min-w-[140px]">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
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
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePushFeishu(conv.id)
                    }}
                  >
                    <Send size={14} />
                    推送飞书文档
                  </button>
                  <hr className="my-1" />
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(conv.id)
                    }}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
