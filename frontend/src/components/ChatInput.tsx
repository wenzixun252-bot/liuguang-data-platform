import { useRef, useState } from 'react'
import { Send, Paperclip, X, Loader2, Database } from 'lucide-react'
import { motion } from 'framer-motion'
import api from '../lib/api'
import toast from 'react-hot-toast'
import DataPicker from './DataPicker'
import type { DataSelection } from './DataPicker'

interface Attachment {
  filename: string
  content_text: string
  char_count: number
}

interface Props {
  onSend: (question: string, attachmentContext?: string) => void
  disabled: boolean
  dataSelection: DataSelection
  onDataSelectionChange: (sel: DataSelection) => void
}

export default function ChatInput({ onSend, disabled, dataSelection, onDataSelectionChange }: Props) {
  const [input, setInput] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [showDataPicker, setShowDataPicker] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSend = () => {
    const question = input.trim()
    if (!question || disabled) return
    onSend(question, attachment?.content_text || undefined)
    setInput('')
    setAttachment(null)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post('/chat/parse-attachment', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setAttachment(res.data)
      toast.success(`已解析: ${res.data.filename} (${res.data.char_count} 字)`)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '文件解析失败')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      <div className="apple-glass-heavy rounded-2xl p-3" style={{ boxShadow: 'var(--shadow-md)' }}>
        {/* 附件预览 */}
        {attachment && (
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-[var(--color-accent-subtle)] rounded-xl text-sm">
            <Paperclip size={14} className="text-[var(--color-accent)]" />
            <span className="text-[var(--color-accent)] flex-1 truncate">
              {attachment.filename} ({attachment.char_count} 字)
            </span>
            <button type="button" onClick={() => setAttachment(null)} className="hover:text-red-500 transition-colors apple-btn" style={{ color: 'var(--color-text-quaternary)' }} title="移除附件">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 关联数据标签 */}
        {dataSelection.mode !== 'all' && (
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-[var(--color-accent-subtle)] rounded-xl text-sm">
            <Database size={14} className="text-[var(--color-accent)]" />
            <span className="text-[var(--color-accent)] flex-1 truncate">
              关联数据: {dataSelection.label}
            </span>
            <button
              type="button"
              onClick={() => onDataSelectionChange({ mode: 'all', label: '全部' })}
              className="hover:text-red-500 transition-colors apple-btn"
              style={{ color: 'var(--color-text-quaternary)' }}
              title="清除关联数据"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* 附件上传按钮 */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || disabled}
            className="p-2 rounded-xl hover:bg-black/[0.04] disabled:opacity-50 transition-colors apple-btn"
            style={{ color: 'var(--color-text-quaternary)' }}
            title="上传附件"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md,.csv"
            className="hidden"
            onChange={handleFileUpload}
          />

          {/* 关联数据按钮 */}
          <button
            type="button"
            onClick={() => setShowDataPicker(true)}
            disabled={disabled}
            className={`p-2 rounded-xl transition-colors apple-btn ${
              dataSelection.mode !== 'all'
                ? 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                : 'hover:bg-black/[0.04]'
            } disabled:opacity-50`}
            style={dataSelection.mode === 'all' ? { color: 'var(--color-text-quaternary)' } : undefined}
            title="关联数据"
          >
            <Database size={16} />
          </button>

          {/* 输入框 */}
          <textarea
            ref={inputRef}
            className="flex-1 resize-none text-sm focus:outline-none min-h-[40px] max-h-[120px] bg-transparent"
            style={{ color: 'var(--color-text-primary)' }}
            placeholder="输入你的问题... (Enter 发送, Shift+Enter 换行)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
          />

          {/* 发送按钮 */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            className="p-2.5 rounded-xl bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </motion.button>
        </div>
      </div>

      {/* 数据选择弹窗 */}
      <DataPicker
        open={showDataPicker}
        selection={dataSelection}
        onClose={() => setShowDataPicker(false)}
        onApply={onDataSelectionChange}
      />
    </>
  )
}
