import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Loader2, Send, Download, UserSearch, X, ChevronDown, ChevronUp, Database, ExternalLink } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../lib/api'
import { getUser } from '../lib/auth'
import toast from 'react-hot-toast'
import { useTaskProgress } from '../hooks/useTaskProgress'
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

export default function ReportPanel({ activeReport, onReportCreated, onClearActive }: Props) {
  const navigate = useNavigate()
  const { addTask, updateTask, removeTask } = useTaskProgress()
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [dataSelection, setDataSelection] = useState<DataSelection>({ mode: 'all', label: '全部' })
  const [showDataPicker, setShowDataPicker] = useState(false)
  const [extraInstructions, setExtraInstructions] = useState('')
  const [generating, setGenerating] = useState(false)

  // 阅读者
  const [persons, setPersons] = useState<PersonEntity[]>([])
  const [selectedReaders, setSelectedReaders] = useState<PersonEntity[]>([])
  const [showReaderPicker, setShowReaderPicker] = useState(false)
  const [personsLoading, setPersonsLoading] = useState(false)

  // 轮询 ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

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

  // 后台生成 + 轮询状态
  const startPollStatus = useCallback((reportId: number, taskId: string) => {
    let pollCount = 0
    pollRef.current = setInterval(async () => {
      pollCount++
      try {
        const res = await api.get(`/reports/${reportId}`)
        const report = res.data
        if (report.status === 'completed') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          updateTask(taskId, { status: 'done', progress: 100, message: '已完成' })
          setGenerating(false)
          onReportCreated()
          toast.success('报告生成完成')
        } else if (report.status === 'failed') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          updateTask(taskId, { status: 'error', progress: 100, message: '生成失败' })
          setGenerating(false)
          onReportCreated()
          toast.error('报告生成失败')
        } else {
          // 仍在生成中
          const progress = Math.min(90, pollCount * 5)
          updateTask(taskId, { progress, message: '后台生成中...' })
        }
      } catch {
        // 网络错误不中断轮询
      }
    }, 3000)
  }, [updateTask, onReportCreated])

  const handleGenerate = async () => {
    if (!selectedTemplate || !title.trim() || !timeStart || !timeEnd) {
      toast.error('请填写完整信息')
      return
    }

    setGenerating(true)

    // 先用临时 ID，拿到后端报告 ID 后切换为 report-{id} 与全局轮询对齐
    const tempTaskId = `report-gen-${Date.now()}`
    addTask(tempTaskId, `报告: ${title.trim().slice(0, 15)}`, '/chat?tab=report')
    updateTask(tempTaskId, { message: '正在提交...', progress: 5 })

    try {
      const res = await api.post('/reports/generate/background', {
        template_id: selectedTemplate,
        title: title.trim(),
        time_range_start: new Date(timeStart).toISOString(),
        time_range_end: new Date(timeEnd).toISOString(),
        data_sources: dataSelection.source_tables || ['document', 'communication'],
        extra_instructions: extraInstructions || null,
        target_reader_ids: selectedReaders.length > 0
          ? selectedReaders.map((r) => r.name)
          : null,
      })

      const reportId = res.data.id
      // 移除临时任务，用与全局轮询一致的 ID 重新注册
      removeTask(tempTaskId)
      const taskId = `report-${reportId}`
      addTask(taskId, `报告: ${title.trim().slice(0, 15)}`, '/chat?tab=report')
      updateTask(taskId, { message: '后台生成中...', progress: 10 })
      onReportCreated() // 刷新左侧列表
      toast.success('报告已提交后台生成')

      // 开始轮询状态（本页面内也轮询，加快响应）
      startPollStatus(reportId, taskId)
    } catch {
      updateTask(tempTaskId, { status: 'error', progress: 100, message: '提交失败' })
      toast.error('报告提交失败')
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

  // 查看模式：报告正在生成中
  if (activeReport && activeReport.status === 'generating') {
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
                  setSelectedTemplate(t.id)
                  applyTemplateDefaults(t.name)
                }}
                className={`p-2.5 text-left border rounded-lg text-sm transition-colors ${
                  selectedTemplate === t.id
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
          </div>
        </div>

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
          disabled={generating || !selectedTemplate || !title.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {generating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              后台生成中...
            </>
          ) : (
            <>
              <FileText size={16} />
              开始生成报告
            </>
          )}
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
