import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  Plus,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Send,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Search,
  Trash2,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface ReportTemplate {
  id: number
  name: string
  template_type: string
  description: string | null
  prompt_template: string
}

interface ReportItem {
  id: number
  title: string
  status: string
  template_id: number | null
  content_markdown: string | null
  time_range_start: string | null
  time_range_end: string | null
  data_sources_used: Record<string, unknown>
  feishu_doc_url: string | null
  created_at: string
  updated_at: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-600', icon: <FileText size={12} /> },
  generating: { label: '生成中', color: 'bg-blue-100 text-blue-600', icon: <Loader2 size={12} className="animate-spin" /> },
  completed: { label: '已完成', color: 'bg-green-100 text-green-600', icon: <CheckCircle size={12} /> },
  failed: { label: '失败', color: 'bg-red-100 text-red-600', icon: <AlertCircle size={12} /> },
  published: { label: '已发布', color: 'bg-purple-100 text-purple-600', icon: <Send size={12} /> },
}

export default function Reports() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<ReportItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const pageSize = 20
  const totalPages = Math.ceil(total / pageSize)

  const fetchReports = () => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (statusFilter) params.status = statusFilter

    api
      .get('/reports', { params })
      .then((res) => {
        setReports(res.data.items)
        setTotal(res.data.total)
      })
      .catch(() => toast.error('加载报告列表失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchReports()
  }, [page, search, statusFilter])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, search, statusFilter])

  const currentIds = reports.map((r) => r.id)
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id))

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(currentIds))
  }

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 份报告吗？`)) return
    try {
      const res = await api.post('/reports/batch-delete', { ids: Array.from(selectedIds) })
      toast.success(`已删除 ${res.data.deleted} 份`)
      setSelectedIds(new Set())
      fetchReports()
    } catch {
      toast.error('批量删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">报告中心</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索报告..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <select
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="generating">生成中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="published">已发布</option>
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
          >
            <Plus size={16} />
            新建报告
          </button>
        </div>
      </div>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
          <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 项</span>
          <button
            onClick={handleBatchDelete}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm"
          >
            <Trash2 size={14} />
            批量删除
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm"
          >
            取消选择
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : reports.length === 0 ? (
          <div className="p-12 text-center text-gray-400">暂无报告，点击上方按钮创建</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3 px-4 w-10">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded" />
                    </th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">标题</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">状态</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">时间范围</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">创建时间</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => {
                    const sc = STATUS_CONFIG[report.status] || STATUS_CONFIG.draft
                    return (
                      <tr
                        key={report.id}
                        className={`border-t border-gray-50 hover:bg-indigo-50/50 transition-colors ${selectedIds.has(report.id) ? 'bg-indigo-50/30' : ''}`}
                      >
                        <td className="py-3 px-4">
                          <input type="checkbox" checked={selectedIds.has(report.id)} onChange={() => toggleSelect(report.id)} className="rounded" />
                        </td>
                        <td className="py-3 px-4 text-gray-800 font-medium">{report.title}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${sc.color}`}>
                            {sc.icon}
                            {sc.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                          {report.time_range_start && report.time_range_end
                            ? `${new Date(report.time_range_start).toLocaleDateString('zh-CN')} ~ ${new Date(report.time_range_end).toLocaleDateString('zh-CN')}`
                            : '-'}
                        </td>
                        <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                          {new Date(report.created_at).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => navigate(`/reports/${report.id}`)}
                            className="text-indigo-600 hover:text-indigo-800 text-sm"
                          >
                            查看
                          </button>
                          {report.feishu_doc_url && (
                            <a
                              href={report.feishu_doc_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-3 text-blue-600 hover:text-blue-800 text-sm"
                            >
                              飞书文档
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">共 {total} 条</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm text-gray-500">{page}/{totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateReportModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            navigate(`/reports/${id}`)
          }}
        />
      )}
    </div>
  )
}

function CreateReportModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [dataSources, setDataSources] = useState(['document', 'communication'])
  const [extra, setExtra] = useState('')
  const [readerOptions, setReaderOptions] = useState<{ user_id: string; name: string; is_internal: boolean }[]>([])
  const [selectedReaders, setSelectedReaders] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    api.get('/report-templates').then((res) => {
      setTemplates(res.data)
      if (res.data.length > 0) setTemplateId(res.data[0].id)
    })
    api.get('/insights/leadership/candidates').then((res) => {
      setReaderOptions(res.data)
    }).catch(() => {})
    // 默认时间范围：最近一周
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 7)
    setTimeEnd(end.toISOString().slice(0, 10))
    setTimeStart(start.toISOString().slice(0, 10))
  }, [])

  const handleGenerate = async () => {
    if (!templateId || !title || !timeStart || !timeEnd) {
      toast.error('请填写完整信息')
      return
    }
    setGenerating(true)
    try {
      const res = await api.post('/reports/generate', {
        template_id: templateId,
        title,
        time_range_start: new Date(timeStart).toISOString(),
        time_range_end: new Date(timeEnd).toISOString(),
        data_sources: dataSources,
        extra_instructions: extra || null,
        target_reader_ids: selectedReaders.length > 0 ? selectedReaders : null,
      })
      toast.success('报告生成完成')
      onCreated(res.data.id)
    } catch {
      toast.error('报告生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const toggleSource = (s: string) => {
    setDataSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">新建报告</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">选择模板</label>
            <select
              value={templateId ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value)
                setTemplateId(id)
                const tpl = templates.find((t) => t.id === id)
                if (tpl && !title) setTitle(`${tpl.name} - ${new Date().toLocaleDateString('zh-CN')}`)
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.template_type === 'system' ? '(系统)' : '(自定义)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">报告标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder="例：2026年第9周周报"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
              <input
                type="date"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
              <input
                type="date"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">数据源</label>
            <div className="flex gap-3">
              {[
                { key: 'document', label: '文档' },
                { key: 'communication', label: '沟通记录' },
              ].map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dataSources.includes(s.key)}
                    onChange={() => toggleSource(s.key)}
                    className="rounded"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">报告阅读者（可选）</label>
            {/* 已选标签 */}
            {selectedReaders.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedReaders.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs cursor-pointer hover:bg-indigo-100"
                    onClick={() => setSelectedReaders((prev) => prev.filter((n) => n !== name))}
                  >
                    {name}
                    <X size={12} />
                  </span>
                ))}
              </div>
            )}
            {/* 可选列表 */}
            <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
              {readerOptions.length === 0 ? (
                <div className="p-3 text-xs text-gray-400 text-center">暂无候选人，请先导入数据</div>
              ) : (
                readerOptions.map((r) => {
                  const isSelected = selectedReaders.includes(r.name)
                  return (
                    <div
                      key={r.user_id}
                      className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-indigo-50/50' : ''}`}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedReaders((prev) => prev.filter((n) => n !== r.name))
                        } else {
                          setSelectedReaders((prev) => [...prev, r.name])
                        }
                      }}
                    >
                      <input type="checkbox" checked={isSelected} readOnly className="rounded pointer-events-none" />
                      <span className="text-gray-800">{r.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${r.is_internal ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
                        {r.is_internal ? '内部' : '外部'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">点击选择/取消阅读者，设置后会根据阅读者的关注领域和偏好定制报告内容</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">补充说明（可选）</label>
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm h-20 resize-none"
              placeholder="例：重点关注XX项目的进展..."
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">
            取消
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {generating ? '生成中...' : '生成报告'}
          </button>
        </div>
      </div>
    </div>
  )
}
