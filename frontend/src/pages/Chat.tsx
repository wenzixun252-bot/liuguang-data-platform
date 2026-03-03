import { useState, useEffect, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { getToken } from '../lib/auth'
import api from '../lib/api'
import toast from 'react-hot-toast'
import ChatSidebar from '../components/ChatSidebar'
import type { ConversationItem } from '../components/ChatSidebar'
import ChatMessages from '../components/ChatMessages'
import type { Message } from '../components/ChatMessages'
import ChatInput from '../components/ChatInput'
import type { DataSelection } from '../components/DataPicker'
import ReportPanel from '../components/ReportPanel'

// ── Prompt 模板 ─────────────────────────────────────────
const PROMPT_TEMPLATES = [
  { label: '数据分析', question: '帮我分析最近一周的工作数据，找出关键趋势' },
  { label: '内容摘要', question: '总结这周的主要工作内容和产出' },
  { label: '信息查询', question: '查找关于项目的相关信息和进展' },
  { label: '会议回顾', question: '回顾最近的会议，列出关键决策和待办事项' },
]

type SceneTab = 'chat' | 'report'

export default function Chat() {
  // 会话相关
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [activeConvId, setActiveConvId] = useState<number | null>(null)
  const [convLoading, setConvLoading] = useState(true)

  // 消息相关
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)

  // 场景 Tab
  const [scene, setScene] = useState<SceneTab>('chat')

  // 关联数据选择
  const [dataSelection, setDataSelection] = useState<DataSelection>({
    mode: 'all',
    label: '全部',
  })

  // ── 加载会话列表 ──────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setConvLoading(true)
    try {
      const res = await api.get('/conversations')
      setConversations(res.data)
    } catch {
      // 静默失败
    }
    setConvLoading(false)
  }, [])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  // ── 加载某个会话的消息 ────────────────────────────────
  const loadConversation = useCallback(async (id: number) => {
    setActiveConvId(id)
    try {
      const res = await api.get(`/conversations/${id}`)
      const msgs: Message[] = (res.data.messages || []).map((m: any) => ({
        role: m.role,
        content: m.content,
        sources: m.sources || [],
      }))
      setMessages(msgs)
    } catch {
      toast.error('加载对话失败')
    }
  }, [])

  // ── 新建会话 ──────────────────────────────────────────
  const handleNewConversation = async () => {
    try {
      const res = await api.post('/conversations', { title: '新对话', scene })
      const newConv: ConversationItem = res.data
      setConversations((prev) => [newConv, ...prev])
      setActiveConvId(newConv.id)
      setMessages([])
    } catch {
      toast.error('新建对话失败')
    }
  }

  // ── 删除会话 ──────────────────────────────────────────
  const handleConvDeleted = (id: number) => {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeConvId === id) {
      setActiveConvId(null)
      setMessages([])
    }
  }

  // ── 发送消息 ──────────────────────────────────────────
  const handleSend = async (question: string, attachmentContext?: string) => {
    if (streaming) return

    // 如果没有活跃会话，先自动创建一个
    let convId = activeConvId
    if (!convId) {
      try {
        const res = await api.post('/conversations', {
          title: question.slice(0, 30),
          scene: 'chat',
        })
        convId = res.data.id
        setActiveConvId(convId)
        setConversations((prev) => [res.data, ...prev])
      } catch {
        toast.error('创建对话失败')
        return
      }
    }

    const userMsg: Message = { role: 'user', content: question }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setStreaming(true)

    // 构建请求体
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    const body: any = {
      question,
      history,
      conversation_id: convId,
    }
    if (dataSelection.mode === 'by_type' && dataSelection.source_tables) {
      body.source_tables = dataSelection.source_tables
    }
    if (dataSelection.mode === 'by_item' && dataSelection.source_ids) {
      body.source_ids = dataSelection.source_ids
    }
    if (attachmentContext) {
      body.attachment_context = attachmentContext
    }

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let sources: string[] = []

      setMessages((prev) => [...prev, { role: 'assistant', content: '', sources: [] }])

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue

          try {
            const parsed = JSON.parse(raw)
            if (parsed.type === 'content') {
              assistantContent += parsed.content
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: assistantContent,
                  sources,
                }
                return updated
              })
            } else if (parsed.type === 'sources') {
              sources = parsed.sources
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: assistantContent,
                  sources,
                }
                return updated
              })
            } else if (parsed.type === 'error') {
              assistantContent += parsed.content
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: assistantContent,
                }
                return updated
              })
            }
          } catch {
            // skip
          }
        }
      }

      // 用前几个字更新会话标题
      if (messages.length === 0 && convId) {
        const newTitle = question.slice(0, 30) + (question.length > 30 ? '...' : '')
        try {
          await api.put(`/conversations/${convId}`, { title: newTitle })
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, title: newTitle } : c))
          )
        } catch {
          // 静默
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: '请求失败，请稍后重试。' },
      ])
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)]">
      {/* 左侧: 会话列表 */}
      <ChatSidebar
        conversations={conversations}
        activeId={activeConvId}
        loading={convLoading}
        onSelect={loadConversation}
        onNew={handleNewConversation}
        onDeleted={handleConvDeleted}
      />

      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0 px-4">
        {/* 顶部: Tab 切换 */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-indigo-500" size={20} />
            <h1 className="text-xl font-bold text-gray-800">流光助手</h1>
          </div>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                scene === 'chat'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setScene('chat')}
            >
              智能问答
            </button>
            <button
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                scene === 'report'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setScene('report')}
            >
              报告生成
            </button>
          </div>
        </div>

        {/* 主内容 */}
        {scene === 'chat' ? (
          <div className="flex-1 flex flex-col min-h-0">
            <ChatMessages
              messages={messages}
              promptTemplates={messages.length === 0 ? PROMPT_TEMPLATES : undefined}
              onTemplateClick={(q) => handleSend(q)}
            />
            <div className="mt-3">
              <ChatInput
                onSend={handleSend}
                disabled={streaming}
                dataSelection={dataSelection}
                onDataSelectionChange={setDataSelection}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <ReportPanel />
          </div>
        )}
      </div>
    </div>
  )
}
