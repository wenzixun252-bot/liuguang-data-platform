import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Loader2, Send, Download, UserSearch, X, ChevronDown, ChevronUp, Database, ExternalLink, Brain, ChevronRight, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../lib/api'
import { getUser, getToken } from '../lib/auth'
import toast from 'react-hot-toast'
import DataPicker from './DataPicker'
import type { DataSelection } from './DataPicker'
import type { ReportItem } from './ReportSidebar'

interface Template {
  id: number
  name: string
  description: string | null
}

interface PersonEntity {
  id: number
  name: string
  entity_type: string
  properties: Record<string, unknown>
}

interface Props {
  /** 从左侧栏选中的报告（查看模式） */
  activeReport: ReportItem | null
  /** 报告创建/更新后回调 */
  onReportCreated: () => void
  /** 清除选中状态，回到配置表单 */
  onClearActive: () => void
}

function ReasoningBlock({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(isStreaming)

  useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])

  return (
    <div className="mb-3 rounded-lg overflow-hidden bg-gray-50 border border-gray-100">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100"
      >
        <Brain size={13} className="text-purple-500" />
        <span>思考过程</span>
        {isStreaming && (
          <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
        )}
        {expanded ? <ChevronDown size={13} className="ml-auto" /> : <ChevronRight size={13} className="ml-auto" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap text-gray-400">
          {reasoning}
        </div>
      )}
    </div>
  )
}

export default function ReportPanel({ activeReport, onReportCreated, onClearActive }: Props) {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [dataSelection, setDataSelection] = useState<DataSelection>({ mode: 'all', label: '全部' })
  const [showDataPicker, setShowDataPicker] = useState(false)
  const [extraInstructions, setExtraInstructions] = useState('')
  const [isCustomMode, setIsCustomMode] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  // 流式输出状态
  const [streamingContent, setStreamingContent] = useState('')
  const [reasoningContent, setReasoningContent] = useState('')
  const [, setStreamingReportId] = useState<number | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)

  // 阅读者
  const [persons, setPersons] = useState<PersonEntity[]>([])
  const [selectedReaders, setSelectedReaders] = useState<PersonEntity[]>([])
  const [showReaderPicker, setShowReaderPicker] = useState(false)
  const [personsLoading, setPersonsLoading] = useState(false)

  useEffect(() => {
    api
      .get('/report-templates')
      .then((res) => {
        const tpls = Array.isArray(res.data) ? res.data : []
        setTemplates(tpls)
        if (tpls.length > 0) {
          setSelectedTemplate(tpls[0].id)
          applyTemplateDefaults(tpls[0].name)
        }
      })
      .catch(() => toast.error('加载报告模板失败'))
  }, [])

  const toLocalDatetime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const applyTemplateDefaults = (templateName: string) => {
    const now = new Date()
    setTimeEnd(toLocalDatetime(now))
    if (templateName.includes('周报')) {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      setTimeStart(toLocalDatetime(weekAgo))
      const tmp = new Date(now.getFullYear(), 0, 1)
      const weekNum = Math.ceil(((now.getTime() - tmp.getTime()) / 86400000 + tmp.getDay() + 1) / 7)
      setTitle(`${now.getFullYear()}年第${weekNum}周周报`)
      setExtraInstructions('')
    } else if (templateName.includes('月报')) {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      setTimeStart(toLocalDatetime(monthStart))
      setTitle(`${now.getFullYear()}年${now.getMonth() + 1}月月报`)
      setExtraInstructions('')
    } else if (templateName.includes('项目')) {
      const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      setTimeStart(toLocalDatetime(threeMonthsAgo))
      setTitle('项目总结报告')
      setExtraInstructions('重点关注项目进度、里程碑完成情况和风险点')
    } else {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      setTimeStart(toLocalDatetime(weekAgo))
      setTitle(templateName)
      setExtraInstructions('')
    }
  }

  useEffect(() => {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    setTimeEnd(toLocalDatetime(now))
    setTimeStart(toLocalDatetime(weekAgo))
  }, [])

  // 查看模式：报告正在生成中 — 轮询刷新状态
  useEffect(() => {
    const target = activeReport && activeReport.status === 'generating' && !generating ? activeReport : null
    if (!target) return

    const poll = async () => {
      try {
        const res = await api.get(`/reports/${target.id}`)
        const updated = res.data as ReportItem
        if (updated.status !== 'generating') {
          onReportCreated()
        }
      } catch {
        // 忽略轮询错误
      }
    }

    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
  }, [activeReport?.id, activeReport?.status, generating])

  // 加载人物
  const loadPersons = async () => {
    if (persons.length > 0) {
      setShowReaderPicker(!showReaderPicker)
      return
    }
    setPersonsLoading(true)
    setShowReaderPicker(true)
    try {
      const res = await api.get('/knowledge-graph/entities', {
        params: { entity_type: 'person', limit: 100 },
      })
      setPersons(res.data || [])
    } catch {
      setPersons([])
    }
    setPersonsLoading(false)
  }

  const toggleReader = (person: PersonEntity) => {
    setSelectedReaders((prev) => {
      const exists = prev.some((p) => p.id === person.id)
      if (exists) return prev.filter((p) => p.id !== person.id)
      return [...prev, person]
    })
  }

  const removeReader = (id: number) => {
    setSelectedReaders((prev) => prev.filter((p) => p.id !== id))
  }

  // 自动滚动流式内容
  useEffect(() => {
    if (generating && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [streamingContent, reasoningContent, generating])

  // 流式生成报告
  const handleGenerate = async () => {
    if (isCustomMode && !customPrompt.trim()) {
      toast.error('请填写报告描述')
      return
    }
    if (!isCustomMode && !selectedTemplate) {
      toast.error('请选择报告模板')
      return
    }
    if (!title.trim() || !timeStart || !timeEnd) {
      toast.error('请填写完整信息')
      return
    }

    setGenerating(true)
    setStreamingContent('')
    setReasoningContent('')
    setStreamingReportId(null)

    try {
      const res = await fetch('/api/reports/generate/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          template_id: isCustomMode ? null : selectedTemplate,
          title: title.trim(),
          time_range_start: new Date(timeStart).toISOString(),
          time_range_end: new Date(timeEnd).toISOString(),
          data_sources: dataSelection.source_tables || ['document', 'communication'],
          extra_instructions: extraInstructions || null,
          target_reader_ids: selectedReaders.length > 0
            ? selectedReaders.map((r) => r.name)
            : null,
          custom_prompt: isCustomMode ? customPrompt.trim() : null,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let content = ''
      let reasoning = ''
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
            if (parsed.type === 'report_id') {
              setStreamingReportId(parsed.id)
            } else if (parsed.type === 'reasoning') {
              reasoning += parsed.content
              setReasoningContent(reasoning)
            } else if (parsed.type === 'content') {
              content += parsed.content
              setStreamingContent(content)
            } else if (parsed.type === 'done') {
              setStreamingReportId(parsed.report_id)
            } else if (parsed.type === 'error') {
              toast.error(`生成失败: ${parsed.content}`)
            }
          } catch { /* skip */ }
        }
      }

      toast.success('报告生成完成')
      onReportCreated()
    } catch (err: any) {
      toast.error(`创建报告失败: ${err.message || '网络错误'}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = (content: string, reportTitle: string) => {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${reportTitle || '报告'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handlePushFeishu = async (reportId: number) => {
    try {
      await api.post(`/reports/${reportId}/push-feishu`)
      toast.success('已推送到飞书')
      onReportCreated()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || ''
      if (detail.includes('重新登录')) {
        toast.error('飞书授权缺少文档写入权限，请退出登录后重新登录', { duration: 5000 })
      } else {
        toast.error(detail || '推送失败')
      }
    }
  }

  // 流式生成中：显示实时内容
  if (generating) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin text-indigo-500" />
            <h3 className="text-sm font-medium text-gray-700">{title}</h3>
            <span className="text-xs text-gray-400">正在生成中...</span>
          </div>
        </div>
        <div ref={streamRef} className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-200 p-6">
          {reasoningContent && (
            <ReasoningBlock reasoning={reasoningContent} isStreaming={!streamingContent} />
          )}
          {streamingContent ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamingContent}
              </ReactMarkdown>
              <span className="inline-block w-1.5 h-4 bg-indigo-500 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
            </div>
          ) : !reasoningContent ? (
            <div className="flex items-center gap-2 text-gray-400 py-8">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">正在收集数据并准备生成...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400 py-2">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">AI 正在思考中，即将开始输出内容...</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 查看模式：显示选中的报告内容
  if (activeReport && activeReport.content_markdown) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700 truncate">{activeReport.title}</h3>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClearActive}
              className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              新建报告
            </button>
            <button
              type="button"
              onClick={() => navigate(`/reports/${activeReport.id}`)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
            >
              <ExternalLink size={12} />
              编辑详情
            </button>
            <button
              type="button"
              onClick={() => handleDownload(activeReport.content_markdown!, activeReport.title)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              <Download size={12} />
              下载
            </button>
            <button
              type="button"
              onClick={() => handlePushFeishu(activeReport.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              <Send size={12} />
              推送飞书
            </button>
          </div>
        </div>
        {activeReport.target_readers && activeReport.target_readers.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs text-gray-400">阅读者:</span>
            {activeReport.target_readers.map((name, i) => (
              <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-full">
                <UserSearch size={10} />
                {name}
              </span>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-200 p-6">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {activeReport.content_markdown}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  if (activeReport && activeReport.status === 'generating' && !generating) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">{activeReport.title}</p>
          <p className="text-xs text-gray-400 mt-1">正在后台生成中，可以切换到其他页面...</p>
        </div>
        <button
          type="button"
          onClick={onClearActive}
          className="px-4 py-2 text-xs text-gray-600 border rounded-lg hover:bg-gray-50"
        >
          新建其他报告
        </button>
      </div>
    )
  }

  // 配置表单模式
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-4 px-1">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={16} className="text-indigo-500" />
          <h3 className="text-sm font-medium text-gray-700">配置报告参数</h3>
        </div>

        {/* 模板选择 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">报告模板</label>
          <div className="grid grid-cols-3 gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setIsCustomMode(false)
                  setSelectedTemplate(t.id)
                  applyTemplateDefaults(t.name)
                }}
                className={`p-2.5 text-left border rounded-lg text-sm transition-colors ${
                  !isCustomMode && selectedTemplate === t.id
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <p className="font-medium text-xs">{t.name}</p>
                {t.description && (
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{t.description}</p>
                )}
              </button>
            ))}
            <button
              onClick={() => {
                setIsCustomMode(true)
                setSelectedTemplate(null)
                setTitle('')
                setExtraInstructions('')
              }}
              className={`p-2.5 text-left border rounded-lg text-sm transition-colors ${
                isCustomMode
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <p className="font-medium text-xs flex items-center gap-1"><Pencil size={12} />自定义</p>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">自由描述你想要的报告</p>
            </button>
          </div>
        </div>

        {/* 自定义报告描述 */}
        {isCustomMode && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">报告描述 <span className="text-red-400">*</span></label>
            <textarea
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
              rows={4}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={"描述你想生成什么样的报告，例如：\n• 按项目维度汇总本周各项目的进展和阻塞\n• 生成一份面向客户的项目交付报告\n• 分析团队沟通频率和协作模式"}
            />
          </div>
        )}

        {/* 标题 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">报告标题</label>
          <input
            className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-indigo-400"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 2026年第10周周报"
          />
        </div>

        {/* 时间范围 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">开始时间</label>
            <input
              type="datetime-local"
              title="开始时间"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-indigo-400"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">结束时间</label>
            <input
              type="datetime-local"
              title="结束时间"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-indigo-400"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
            />
          </div>
        </div>

        {/* 数据来源 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">数据来源</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDataPicker(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-colors ${
                dataSelection.mode !== 'all'
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-600'
                  : 'border-gray-200 text-gray-600 hover:border-indigo-300'
              }`}
            >
              <Database size={14} className="text-indigo-500" />
              {dataSelection.mode === 'all' ? '全部数据（点击选择）' : dataSelection.label}
            </button>
            {dataSelection.mode !== 'all' && (
              <button
                type="button"
                title="清除选择"
                onClick={() => setDataSelection({ mode: 'all', label: '全部' })}
                className="text-gray-400 hover:text-red-500"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* 阅读者选择 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">阅读者（关联人物画像）<span className="text-gray-400 ml-1">选填</span></label>
          {selectedReaders.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedReaders.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 text-xs rounded-full"
                >
                  <UserSearch size={10} />
                  {r.name}
                  <button type="button" title="移除" onClick={() => removeReader(r.id)} className="hover:text-red-500">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <button
            onClick={loadPersons}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <UserSearch size={14} className="text-indigo-500" />
            选择阅读者
            {showReaderPicker ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showReaderPicker && (
            <div className="mt-2 border rounded-lg max-h-40 overflow-y-auto">
              {personsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 size={16} className="animate-spin text-gray-400" />
                </div>
              ) : persons.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  暂无人物画像，请先在知识图谱中构建
                </p>
              ) : (
                persons.filter((p) => p.name !== getUser()?.name).map((person) => {
                  const isSelected = selectedReaders.some((r) => r.id === person.id)
                  return (
                    <label
                      key={person.id}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0 ${
                        isSelected ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleReader(person)}
                        className="w-3.5 h-3.5 text-indigo-600 rounded"
                      />
                      <UserSearch size={12} className="text-gray-400" />
                      <span className="text-xs text-gray-700">{person.name}</span>
                    </label>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* 额外指令 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">额外指令 (可选)</label>
          <textarea
            className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
            rows={2}
            value={extraInstructions}
            onChange={(e) => setExtraInstructions(e.target.value)}
            placeholder="例: 重点关注项目进度和风险点"
          />
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerate}
          disabled={generating || (!isCustomMode && !selectedTemplate) || (isCustomMode && !customPrompt.trim()) || !title.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <FileText size={16} />
          开始生成报告
        </button>
      </div>

      <DataPicker
        open={showDataPicker}
        selection={dataSelection}
        onClose={() => setShowDataPicker(false)}
        onApply={setDataSelection}
      />
    </div>
  )
}
