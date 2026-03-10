import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, FileText, MessageSquare } from 'lucide-react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface SourceRef {
  type: string
  id: number
  title: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: (SourceRef | string)[]
}

function normalizeSource(s: SourceRef | string): SourceRef {
  if (typeof s === 'string') {
    const [type, idStr] = s.split(':')
    return { type, id: Number(idStr), title: s }
  }
  return s
}

function getSourceUrl(source: SourceRef): string {
  switch (source.type) {
    case 'document': return `/documents?highlight=${source.id}`
    case 'communication': return `/communications?highlight=${source.id}`
    default: return '#'
  }
}

interface Props {
  messages: Message[]
  promptTemplates?: { label: string; question: string }[]
  onTemplateClick?: (question: string) => void
}

export default function ChatMessages({ messages, promptTemplates, onTemplateClick }: Props) {
  const navigate = useNavigate()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0 && promptTemplates && promptTemplates.length > 0) {
    return (
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-4">
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles size={48} className="text-indigo-300/60 mb-4" />
        </motion.div>
        <p className="text-lg mb-2" style={{ color: 'var(--color-text-tertiary)' }}>有什么我能帮你的？</p>
        <p className="text-sm mb-6" style={{ color: 'var(--color-text-quaternary)' }}>基于你的数据资产为你提供智能问答</p>
        <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
          {promptTemplates.map((t) => (
            <motion.button
              key={t.label}
              whileHover={{ y: -2, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              onClick={() => onTemplateClick?.(t.question)}
              className="text-left p-4 apple-card-interactive"
            >
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{t.label}</p>
              <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-text-tertiary)' }}>{t.question}</p>
            </motion.button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-4 pb-4 px-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full space-y-4" style={{ color: 'var(--color-text-tertiary)' }}>
          <Sparkles size={48} className="text-indigo-300/60" />
          <p className="text-lg">有什么我能帮你的？</p>
          <p className="text-sm">基于你的数据资产为你提供智能问答</p>
        </div>
      )}

      {messages.map((msg, i) => (
        <motion.div
          key={i}
          initial={i === messages.length - 1 ? { opacity: 0, y: 8, scale: 0.96 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[80%] px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'bg-[var(--color-accent)] text-white rounded-[20px] rounded-br-[6px]'
                : 'apple-card rounded-[20px] rounded-bl-[6px] p-4'
            }`}
            style={msg.role === 'assistant' ? { color: 'var(--color-text-primary)' } : undefined}
          >
            {msg.role === 'assistant' ? (
              <div className="prose prose-sm max-w-none prose-pre:bg-gray-900 prose-pre:text-gray-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content || '...'}
                </ReactMarkdown>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-black/[0.06]">
                    <p className="text-xs mb-1" style={{ color: 'var(--color-text-quaternary)' }}>引用来源:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.sources.map((s) => {
                        const ref = normalizeSource(s)
                        return (
                          <span
                            key={`${ref.type}:${ref.id}`}
                            onClick={() => navigate(getSourceUrl(ref))}
                            className="px-2.5 py-1 bg-[var(--color-accent-subtle)] text-[var(--color-accent)] text-xs rounded-lg font-medium cursor-pointer hover:bg-indigo-100 transition-colors inline-flex items-center gap-1"
                          >
                            {ref.type === 'document' ? <FileText size={10} /> : <MessageSquare size={10} />}
                            {ref.title}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
        </motion.div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
