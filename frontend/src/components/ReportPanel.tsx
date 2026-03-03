import { useState, useEffect } from 'react'
import { FileText, Loader2, Send, Download, UserSearch, X, ChevronDown, ChevronUp, Database } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../lib/api'
import { getToken } from '../lib/auth'
import toast from 'react-hot-toast'
import DataPicker from './DataPicker'
import type { DataSelection } from './DataPicker'

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


export default function ReportPanel() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [dataSelection, setDataSelection] = useState<DataSelection>({ mode: 'all', label: '全部' })
  const [showDataPicker, setShowDataPicker] = useState(false)
  const [extraInstructions, setExtraInstructions] = useState('')
  const [generating, setGenerating] = useState(false)
  const [reportContent, setReportContent] = useState('')

  // 阅读者相关
  const [persons, setPersons] = useState<PersonEntity[]>([])
  const [selectedReaders, setSelectedReaders] = useState<PersonEntity[]>([])
  const [showReaderPicker, setShowReaderPicker] = useState(false)
  const [personsLoading, setPersonsLoading] = useState(false)

  useEffect(() => {
    api
      .get('/report-templates')
      .then((res) => {
        setTemplates(res.data)
        if (res.data.length > 0) setSelectedTemplate(res.data[0].id)
      })
      .catch(() => toast.error('加载报告模板失败'))
  }, [])

  // 设置默认时间范围: 最近一周
  useEffect(() => {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    setTimeEnd(now.toISOString().slice(0, 16))
    setTimeStart(weekAgo.toISOString().slice(0, 16))
  }, [])

  // 加载人物画像列表
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

  const handleGenerate = async () => {
    if (!selectedTemplate || !title.trim() || !timeStart || !timeEnd) {
      toast.error('请填写完整信息')
      return
    }

    setGenerating(true)
    setReportContent('')

    try {
      const res = await fetch('/api/reports/generate/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          template_id: selectedTemplate,
          title: title.trim(),
          time_range_start: new Date(timeStart).toISOString(),
          time_range_end: new Date(timeEnd).toISOString(),
          data_sources: dataSelection.source_tables || ['document', 'meeting', 'chat_message'],
          extra_instructions: extraInstructions || null,
          target_reader_ids: selectedReaders.length > 0
            ? selectedReaders.map((r) => String(r.id))
            : null,
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
              setReportContent(content)
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      toast.error('报告生成失败')
    }
    setGenerating(false)
  }

  const handleDownload = () => {
    const blob = new Blob([reportContent], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || '报告'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handlePushFeishu = async () => {
    try {
      await api.post('/reports', {
        template_id: selectedTemplate,
        title: title.trim(),
        content_markdown: reportContent,
        push_feishu: true,
      })
      toast.success('已推送到飞书')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '推送失败')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {reportContent ? (
        /* 报告结果视图 */
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">{title}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setReportContent('')}
                className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                重新配置
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                <Download size={12} />
                下载
              </button>
              <button
                onClick={handlePushFeishu}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                <Send size={12} />
                推送飞书
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-200 p-6">
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {reportContent || '...'}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      ) : (
        /* 报告配置表单 */
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
                    if (!title) setTitle(t.name)
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
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-indigo-400"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">结束时间</label>
              <input
                type="datetime-local"
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
            <label className="block text-xs text-gray-500 mb-1">阅读者（关联人物画像）</label>

            {/* 已选阅读者标签 */}
            {selectedReaders.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedReaders.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 text-xs rounded-full"
                  >
                    <UserSearch size={10} />
                    {r.name}
                    <button
                      onClick={() => removeReader(r.id)}
                      className="hover:text-red-500"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* 展开/收起按钮 */}
            <button
              onClick={loadPersons}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              <UserSearch size={14} className="text-indigo-500" />
              选择阅读者
              {showReaderPicker ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {/* 人物列表 */}
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
                  persons.map((person) => {
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
                生成中...
              </>
            ) : (
              <>
                <FileText size={16} />
                开始生成报告
              </>
            )}
          </button>
        </div>
      )}

      {/* 数据选择弹窗 */}
      <DataPicker
        open={showDataPicker}
        selection={dataSelection}
        onClose={() => setShowDataPicker(false)}
        onApply={setDataSelection}
      />
    </div>
  )
}
