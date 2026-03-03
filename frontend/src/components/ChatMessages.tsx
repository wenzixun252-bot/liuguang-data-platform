import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
}

interface Props {
  messages: Message[]
  promptTemplates?: { label: string; question: string }[]
  onTemplateClick?: (question: string) => void
}

export default function ChatMessages({ messages, promptTemplates, onTemplateClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0 && promptTemplates && promptTemplates.length > 0) {
    return (
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-4">
        <Sparkles size={48} className="text-indigo-200 mb-4" />
        <p className="text-lg text-gray-400 mb-2">有什么我能帮你的？</p>
        <p className="text-sm text-gray-400 mb-6">基于你的数据资产为你提供智能问答</p>
        <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
          {promptTemplates.map((t) => (
            <button
              key={t.label}
              onClick={() => onTemplateClick?.(t.question)}
              className="text-left p-3 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <p className="text-sm font-medium text-gray-700">{t.label}</p>
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">{t.question}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-4 pb-4 px-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
          <Sparkles size={48} className="text-indigo-200" />
          <p className="text-lg">有什么我能帮你的？</p>
          <p className="text-sm">基于你的数据资产为你提供智能问答</p>
        </div>
      )}

      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white'
                : 'bg-white shadow-sm border border-gray-100 text-gray-800'
            }`}
          >
            {msg.role === 'assistant' ? (
              <div className="prose prose-sm max-w-none prose-pre:bg-gray-900 prose-pre:text-gray-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content || '...'}
                </ReactMarkdown>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">引用来源:</p>
                    <div className="flex flex-wrap gap-1">
                      {msg.sources.map((s) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-full"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
