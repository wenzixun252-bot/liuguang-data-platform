import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Send, Edit3, Eye, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface ReportDetail {
  id: number
  title: string
  content_markdown: string | null
  status: string
  time_range_start: string | null
  time_range_end: string | null
  data_sources_used: Record<string, unknown>
  feishu_doc_url: string | null
  created_at: string
  updated_at: string
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [pushing, setPushing] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .get(`/reports/${id}`)
      .then((res) => {
        setReport(res.data)
        setEditContent(res.data.content_markdown || '')
        setEditTitle(res.data.title)
      })
      .catch(() => toast.error('加载报告失败'))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async () => {
    if (!report) return
    setSaving(true)
    try {
      const res = await api.put(`/reports/${report.id}`, {
        title: editTitle,
        content_markdown: editContent,
      })
      setReport(res.data)
      setEditing(false)
      toast.success('已保存')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handlePushFeishu = async () => {
    if (!report) return
    setPushing(true)
    try {
      const res = await api.post(`/reports/${report.id}/push-feishu`)
      setReport(res.data)
      toast.success('已推送到飞书文档')
    } catch (err: any) {
      const detail = err?.response?.data?.detail || ''
      if (detail.includes('重新登录')) {
        toast.error('飞书授权缺少文档写入权限，请退出登录后重新登录', { duration: 5000 })
      } else {
        toast.error(`推送失败: ${detail || '未知错误'}`)
      }
    } finally {
      setPushing(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">加载中...</div>
  }

  if (!report) {
    return <div className="flex items-center justify-center h-64 text-gray-400">报告不存在</div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={20} />
          </button>
          {editing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-xl font-bold text-gray-800 border-b border-gray-300 focus:outline-none focus:border-indigo-500 px-1"
            />
          ) : (
            <h1 className="text-xl font-bold text-gray-800">{report.title}</h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                保存
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
              >
                <Edit3 size={14} />
                编辑
              </button>
              <button
                onClick={handlePushFeishu}
                disabled={pushing || !report.content_markdown}
                className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {pushing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                推送飞书
              </button>
            </>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        {report.time_range_start && report.time_range_end && (
          <span>
            数据范围: {new Date(report.time_range_start).toLocaleDateString('zh-CN')} ~{' '}
            {new Date(report.time_range_end).toLocaleDateString('zh-CN')}
          </span>
        )}
        <span>创建于 {new Date(report.created_at).toLocaleString('zh-CN')}</span>
        {report.feishu_doc_url && (
          <a
            href={report.feishu_doc_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            查看飞书文档
          </a>
        )}
      </div>

      {/* Content */}
      {editing ? (
        <div className="grid grid-cols-2 gap-4 h-[calc(100vh-220px)]">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-2 bg-gray-50 border-b text-sm text-gray-500 flex items-center gap-1">
              <Edit3 size={14} />
              Markdown 编辑
            </div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="flex-1 p-4 text-sm font-mono resize-none focus:outline-none"
            />
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-2 bg-gray-50 border-b text-sm text-gray-500 flex items-center gap-1">
              <Eye size={14} />
              预览
            </div>
            <div className="flex-1 p-6 overflow-y-auto prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{editContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-6 min-h-[400px]">
          {report.content_markdown ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content_markdown}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-12">
              {report.status === 'generating' ? '报告正在生成中...' : '暂无内容'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
