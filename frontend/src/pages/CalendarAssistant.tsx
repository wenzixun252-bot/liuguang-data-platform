import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CalendarClock, Clock, MapPin, Users, Video, RefreshCw,
  Send, Loader2, Settings, ChevronRight, Sparkles, X,
  User, Calendar, FileText,
} from 'lucide-react'
import api from '../lib/api'
import { getToken } from '../lib/auth'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'
import PersonProfileWidget from '../components/insights/PersonProfileWidget'

// ── 类型定义 ──────────────────────────────────────────────

interface CalendarAttendee {
  name: string | null
  open_id: string | null
  status: string | null
}

interface CalendarEvent {
  event_id: string
  summary: string
  description: string | null
  start_time: string
  end_time: string
  location: string | null
  organizer_name: string | null
  attendees: CalendarAttendee[]
  meeting_url: string | null
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ── 工具函数 ──────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatFullDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function formatDateGroupLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const dateStr = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const weekday = d.toLocaleDateString('zh-CN', { weekday: 'short' })

  if (d.toDateString() === today.toDateString()) return `${dateStr} ${weekday} · 今天`
  if (d.toDateString() === tomorrow.toDateString()) return `${dateStr} ${weekday} · 明天`
  return `${dateStr} ${weekday}`
}

function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const dateKey = new Date(e.start_time).toDateString()
    if (!map.has(dateKey)) map.set(dateKey, [])
    map.get(dateKey)!.push(e)
  }
  return map
}

function getDurationMinutes(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`
}

function rsvpIcon(status: string | null): string {
  switch (status) {
    case 'accept': return '✓'
    case 'decline': return '✗'
    case 'tentative': return '?'
    default: return '·'
  }
}

function rsvpColor(status: string | null): string {
  switch (status) {
    case 'accept': return 'bg-green-50 text-green-700 border-green-200'
    case 'decline': return 'bg-red-50 text-red-700 border-red-200'
    case 'tentative': return 'bg-amber-50 text-amber-700 border-amber-200'
    default: return 'bg-gray-50 text-gray-600 border-gray-200'
  }
}

// ── 主组件 ────────────────────────────────────────────────

export default function CalendarAssistant() {
  // 日历事件
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(3)

  // 选中的事件
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  // 简报
  const [briefContent, setBriefContent] = useState('')
  const [briefStreaming, setBriefStreaming] = useState(false)

  // 追问对话
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)

  // 提醒偏好
  const [showSettings, setShowSettings] = useState(false)
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [reminderMinutes, setReminderMinutes] = useState(30)

  // 参会人画像
  const [profilePerson, setProfilePerson] = useState<string | null>(null)

  const briefPanelRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // ── 获取日历事件 ────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/calendar/events', { params: { days } })
      setEvents(res.data)
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '未知错误'
      if (detail.includes('重新登录') || detail.includes('重新登录以授权')) {
        toast.error('飞书日历授权已过期，请重新登录')
      } else if (detail.includes('权限未授权')) {
        toast.error('日历权限未授权，请退出后重新登录以授权日历访问')
      } else {
        toast.error(`获取日程失败: ${detail}`)
      }
    }
    setLoading(false)
  }, [days])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  // ── 加载提醒偏好 ────────────────────────────────────────
  useEffect(() => {
    api.get('/calendar/reminder-prefs').then(res => {
      setReminderEnabled(res.data.enabled)
      setReminderMinutes(res.data.minutes_before)
    }).catch(() => {})
  }, [])

  // ── 保存提醒偏好 ────────────────────────────────────────
  const saveReminderPrefs = async () => {
    try {
      await api.put('/calendar/reminder-prefs', {
        enabled: reminderEnabled,
        minutes_before: reminderMinutes,
      })
      toast.success('提醒设置已保存')
      setShowSettings(false)
    } catch {
      toast.error('保存设置失败')
    }
  }

  // ── 选中事件（查看详情，不自动生成简报）──────────────────
  const selectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event)
    setProfilePerson(null)
  }

  // ── 生成会前简报 (SSE) ──────────────────────────────────
  const generateBrief = async (event: CalendarEvent) => {
    setSelectedEvent(event)
    setBriefContent('')
    setChatMessages([])
    setBriefStreaming(true)
    setProfilePerson(null)

    try {
      const res = await fetch('/api/calendar/brief', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          event_id: event.event_id,
          summary: event.summary,
          description: event.description,
          start_time: event.start_time,
          attendees: event.attendees,
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let content = ''
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
              content += parsed.content
              setBriefContent(content)
            } else if (parsed.type === 'error') {
              toast.error(parsed.content)
            }
          } catch { /* 忽略解析错误 */ }
        }
      }
    } catch (err: any) {
      toast.error(`生成简报失败: ${err.message}`)
    }

    setBriefStreaming(false)
  }

  // ── 简报追问 (SSE) ─────────────────────────────────────
  const handleChatSend = async () => {
    if (!chatInput.trim() || chatStreaming || !selectedEvent) return

    const question = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: question }])
    setChatStreaming(true)

    try {
      const res = await fetch('/api/calendar/brief/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          question,
          event_context: briefContent,
          history: chatMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''

      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])

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
              setChatMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
                return updated
              })
            }
          } catch { /* 忽略 */ }
        }
      }
    } catch (err: any) {
      toast.error(`追问失败: ${err.message}`)
    }

    setChatStreaming(false)
  }

  // 自动滚动
  useEffect(() => {
    if (briefStreaming && briefPanelRef.current) {
      briefPanelRef.current.scrollTop = briefPanelRef.current.scrollHeight
    }
  }, [briefContent, briefStreaming])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // ── 渲染 ───────────────────────────────────────────────

  const groupedEvents = groupEventsByDate(events)

  return (
    <div className="h-[calc(100vh-7rem)] flex gap-4">
      {/* ── 左侧：日程列表 ── */}
      <div className="w-[340px] flex-shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <CalendarClock size={20} className="text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-800">日程管家</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="提醒设置"
            >
              <Settings size={16} />
            </button>
            <button
              onClick={fetchEvents}
              disabled={loading}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="刷新"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* 天数选择 */}
        <div className="flex gap-1 px-4 py-2 border-b border-gray-50">
          {[1, 3, 7].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                days === d
                  ? 'bg-indigo-100 text-indigo-700 font-medium'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {d === 1 ? '今天' : `${d}天`}
            </button>
          ))}
        </div>

        {/* 事件列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" />
              加载日程中...
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              <CalendarClock size={40} className="mx-auto mb-3 text-gray-300" />
              <p>暂无日程</p>
              <p className="text-xs mt-1">未来 {days} 天内没有日历事件</p>
            </div>
          ) : (
            Array.from(groupedEvents.entries()).map(([dateKey, dayEvents]) => (
              <div key={dateKey} className="mb-3">
                {/* 日期分组标题 */}
                <div className="flex items-center gap-2 px-1 mb-2 mt-2">
                  <span className="text-sm font-semibold text-indigo-600">
                    {formatDateGroupLabel(dayEvents[0].start_time)}
                  </span>
                  <div className="flex-1 h-px bg-indigo-100" />
                  <span className="text-xs text-gray-400">{dayEvents.length}场</span>
                </div>
                <div className="space-y-2">
                  {dayEvents.map(event => {
                    const isSelected = selectedEvent?.event_id === event.event_id
                    const duration = getDurationMinutes(event.start_time, event.end_time)
                    return (
                      <button
                        key={event.event_id}
                        onClick={() => selectEvent(event)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          isSelected
                            ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                            : 'border-gray-100 bg-gray-50/50 hover:border-gray-200 hover:bg-white hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className={`text-sm font-medium leading-tight ${isSelected ? 'text-indigo-700' : 'text-gray-800'}`}>
                            {event.summary}
                          </h3>
                          <ChevronRight size={14} className={`flex-shrink-0 mt-0.5 ${isSelected ? 'text-indigo-400' : 'text-gray-300'}`} />
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {formatTime(event.start_time)} - {formatTime(event.end_time)}
                            <span className="text-gray-400">({duration}min)</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          {event.organizer_name && (
                            <span className="flex items-center gap-1">
                              <User size={11} />
                              {event.organizer_name}
                            </span>
                          )}
                          {event.location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={11} />
                              {event.location.length > 12 ? event.location.slice(0, 12) + '...' : event.location}
                            </span>
                          )}
                          {event.attendees.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Users size={11} />
                              {event.attendees.length}人
                            </span>
                          )}
                          {event.meeting_url && (
                            <span className="flex items-center gap-1">
                              <Video size={11} />
                              视频
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 中间：详情 + 简报 + 追问 ── */}
      <div className={`flex-1 bg-white rounded-xl border border-gray-200 flex flex-col min-w-0 ${profilePerson ? 'max-w-[calc(100%-340px-360px-2rem)]' : ''}`}>
        {!selectedEvent ? (
          /* 空状态 */
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <Sparkles size={48} className="mb-4 text-indigo-200" />
            <p className="text-base font-medium text-gray-500">选择一个日程查看详情</p>
            <p className="text-sm mt-1">点击左侧日程，查看会议详情并生成 AI 简报</p>
          </div>
        ) : (
          <>
            {/* 事件详情头部 */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-semibold text-gray-800">{selectedEvent.summary}</h2>
                <button
                  onClick={() => generateBrief(selectedEvent)}
                  disabled={briefStreaming}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {briefStreaming ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {briefContent ? '重新生成简报' : '生成会前简报'}
                </button>
              </div>

              {/* 完整日期 + 时间 + 时长 */}
              <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                <Calendar size={14} className="text-gray-400" />
                <span>{formatFullDate(selectedEvent.start_time)}</span>
                <span className="text-gray-300">|</span>
                <span>{formatTime(selectedEvent.start_time)} - {formatTime(selectedEvent.end_time)}</span>
                <span className="text-xs text-gray-400">
                  ({formatDuration(getDurationMinutes(selectedEvent.start_time, selectedEvent.end_time))})
                </span>
              </div>

              {/* 详情元信息行 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                {selectedEvent.organizer_name && (
                  <span className="flex items-center gap-1">
                    <User size={12} className="text-gray-400" />
                    组织者: {selectedEvent.organizer_name}
                  </span>
                )}
                {selectedEvent.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} className="text-gray-400" />
                    {selectedEvent.location}
                  </span>
                )}
                {selectedEvent.meeting_url && (
                  <a
                    href={selectedEvent.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700"
                  >
                    <Video size={12} />
                    加入视频会议
                  </a>
                )}
              </div>

              {/* 会议描述预览 */}
              {selectedEvent.description && (
                <div className="mt-3 p-2.5 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                    <FileText size={11} />
                    会议描述
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                    {selectedEvent.description}
                  </p>
                </div>
              )}

              {/* 参会人芯片 */}
              {selectedEvent.attendees.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center gap-1 text-xs text-gray-400 mb-1.5">
                    <Users size={11} />
                    参会人 ({selectedEvent.attendees.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedEvent.attendees.map((att, i) => (
                      <button
                        key={i}
                        onClick={() => att.name && setProfilePerson(att.name)}
                        disabled={!att.name}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${rsvpColor(att.status)} ${
                          att.name ? 'hover:shadow-sm hover:scale-105 cursor-pointer' : 'cursor-default'
                        }`}
                        title={att.name ? `点击查看 ${att.name} 的画像` : undefined}
                      >
                        <span className="font-medium">{rsvpIcon(att.status)}</span>
                        <span>{att.name || att.open_id || '未知'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 简报内容 + 追问 */}
            <div ref={briefPanelRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* 简报 */}
              {briefContent ? (
                <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-600 prose-li:text-gray-600">
                  <ReactMarkdown>{briefContent}</ReactMarkdown>
                </div>
              ) : briefStreaming ? (
                <div className="flex items-center gap-2 text-gray-400 py-8">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">正在收集信息并生成会前简报...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <Sparkles size={24} className="mb-2 text-indigo-200" />
                  <p className="text-sm">点击右上角按钮生成 AI 会前简报</p>
                </div>
              )}

              {/* 追问消息 */}
              {chatMessages.length > 0 && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="text-xs font-medium text-gray-400">追问对话</div>
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-50 text-indigo-800 ml-8'
                          : 'bg-gray-50 text-gray-700 mr-8'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 追问输入框 */}
            {briefContent && !briefStreaming && (
              <div className="border-t border-gray-100 px-4 py-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChatSend()}
                    placeholder="针对这个会议继续提问..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                    disabled={chatStreaming}
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={!chatInput.trim() || chatStreaming}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {chatStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 右侧：参会人画像面板 ── */}
      {profilePerson && (
        <div className="w-[360px] flex-shrink-0">
          <PersonProfileWidget
            selectedPersonName={profilePerson}
            onClose={() => setProfilePerson(null)}
          />
        </div>
      )}

      {/* ── 提醒设置弹窗 ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-[380px] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">提醒设置</h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <span className="text-sm text-gray-700">启用飞书机器人提醒</span>
                <button
                  onClick={() => setReminderEnabled(!reminderEnabled)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    reminderEnabled ? 'bg-indigo-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      reminderEnabled ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </label>

              {reminderEnabled && (
                <div>
                  <label className="text-sm text-gray-700 block mb-1">提前提醒时间</label>
                  <select
                    value={reminderMinutes}
                    onChange={e => setReminderMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  >
                    <option value={15}>15 分钟</option>
                    <option value={30}>30 分钟</option>
                    <option value={60}>1 小时</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowSettings(false)}
                className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={saveReminderPrefs}
                className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
