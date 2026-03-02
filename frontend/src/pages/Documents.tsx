import { useEffect, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, X, Paperclip, ExternalLink, Download, Image, User, Trash2 } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { ColumnSettingsButton, useColumnSettings, type ColumnDef } from '../components/ColumnSettings'
import { getUser } from '../lib/auth'

const DOC_COLUMNS: ColumnDef[] = [
  { key: 'title', label: '标题' },
  { key: 'summary', label: '摘要' },
  { key: 'source_type', label: '来源' },
  { key: 'uploader_name', label: '上传人' },
  { key: 'category', label: '分类', defaultVisible: false },
  { key: 'file_type', label: '类型', defaultVisible: false },
  { key: 'author', label: '作者', defaultVisible: false },
  { key: 'time', label: '时间' },
]

interface AttachmentMeta {
  file_token: string
  name: string
  size: number
  type: string
}

interface LinkMeta {
  field_name: string
  text: string
  link: string
}

interface DocumentItem {
  id: number
  owner_id: string
  title: string | null
  source_type: string
  source_app_token: string | null
  source_table_id: string | null
  content_text: string
  summary: string | null
  author: string | null
  category: string | null
  file_type: string | null
  tags: Record<string, unknown>
  doc_url: string | null
  uploader_name: string | null
  extra_fields?: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  feishu_record_id: string | null
  bitable_url: string | null
  synced_at: string | null
  created_at: string
}

interface DocumentListResponse {
  items: DocumentItem[]
  total: number
  page: number
  page_size: number
}

const SOURCE_LABELS: Record<string, string> = {
  cloud: '飞书同步',
  local: '本地上传',
}

export default function Documents() {
  const [data, setData] = useState<DocumentListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [categoryFilter, _setCategoryFilter] = useState('')
  const [selected, setSelected] = useState<DocumentItem | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { isVisible, toggle, columns: colDefs } = useColumnSettings('documents', DOC_COLUMNS)

  const pageSize = 20

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (sourceFilter) params.source_type = sourceFilter
    if (categoryFilter) params.category = categoryFilter

    api.get('/documents/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载文档列表失败'))
      .finally(() => setLoading(false))
  }, [page, search, sourceFilter, categoryFilter, refreshKey])

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">文档</h1>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索文档..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>

          <select
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}
          >
            <option value="">全部来源</option>
            <option value="cloud">飞书同步</option>
            <option value="local">本地上传</option>
          </select>
          <ColumnSettingsButton columns={colDefs} isVisible={isVisible} toggle={toggle} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {isVisible('title') && <th className="text-left py-3 px-4 text-gray-500 font-medium">标题</th>}
                    {isVisible('summary') && <th className="text-left py-3 px-4 text-gray-500 font-medium">摘要</th>}
                    {isVisible('source_type') && <th className="text-left py-3 px-4 text-gray-500 font-medium">来源</th>}
                    {isVisible('uploader_name') && <th className="text-left py-3 px-4 text-gray-500 font-medium">上传人</th>}
                    {isVisible('category') && <th className="text-left py-3 px-4 text-gray-500 font-medium">分类</th>}
                    {isVisible('file_type') && <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>}
                    {isVisible('author') && <th className="text-left py-3 px-4 text-gray-500 font-medium">作者</th>}
                    {isVisible('time') && <th className="text-left py-3 px-4 text-gray-500 font-medium">时间</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-gray-50 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                      onClick={() => setSelected(item)}
                    >
                      {isVisible('title') && <td className="py-3 px-4 text-gray-800 font-medium max-w-[200px] truncate">{item.title || '无标题'}</td>}
                      {isVisible('summary') && <td className="py-3 px-4 text-gray-500 max-w-[250px] truncate">{item.summary || item.content_text?.slice(0, 60) || '-'}</td>}
                      {isVisible('source_type') && (
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 rounded-full text-xs ${item.source_type === 'cloud' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
                            {SOURCE_LABELS[item.source_type] || item.source_type}
                          </span>
                        </td>
                      )}
                      {isVisible('uploader_name') && <td className="py-3 px-4 text-gray-500">{item.uploader_name || '-'}</td>}
                      {isVisible('category') && <td className="py-3 px-4 text-gray-500">{item.category || '-'}</td>}
                      {isVisible('file_type') && <td className="py-3 px-4 text-gray-500">{item.file_type ? item.file_type.toUpperCase() : '-'}</td>}
                      {isVisible('author') && <td className="py-3 px-4 text-gray-500">{item.author || '-'}</td>}
                      {isVisible('time') && <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{new Date(item.synced_at || item.created_at).toLocaleString('zh-CN')}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">共 {data.total} 条，第 {page}/{totalPages} 页</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
                    <ChevronLeft size={16} />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-12 text-center text-gray-400">暂无文档</div>
        )}
      </div>

      {/* Detail panel */}
      {selected && <DocumentDetail doc={selected} onClose={() => setSelected(null)} onDelete={async (id) => {
        if (!confirm('确定要删除这条数据吗？')) return
        try {
          await api.delete(`/documents/${id}`)
          toast.success('已删除')
          setSelected(null)
          setRefreshKey((k) => k + 1)
        } catch { toast.error('删除失败') }
      }} />}
    </div>
  )
}

function DocumentDetail({ doc, onClose, onDelete }: { doc: DocumentItem; onClose: () => void; onDelete: (id: number) => void }) {
  const currentUser = getUser()
  const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.feishu_open_id === doc.owner_id)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">文档详情</h2>
          <div className="flex items-center gap-2">
            {canDelete && (
              <button onClick={() => onDelete(doc.id)} className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-700" title="删除">
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <Field label="标题" value={doc.title || '无标题'} />
          <Field label="来源" value={SOURCE_LABELS[doc.source_type] || doc.source_type} />
          {doc.uploader_name && <Field label="上传人" value={doc.uploader_name} icon={<User size={14} />} />}
          {doc.author && <Field label="作者" value={doc.author} />}
          {doc.category && <Field label="分类" value={doc.category} />}
          {doc.file_type && <Field label="文件类型" value={doc.file_type.toUpperCase()} />}
          <Field label="时间" value={new Date(doc.synced_at || doc.created_at).toLocaleString('zh-CN')} />

          {/* 文档链接/下载 */}
          {doc.source_type === 'local' && (
            <div>
              <p className="text-sm text-gray-500 mb-1">文件操作</p>
              <button
                onClick={async () => {
                  try {
                    const resp = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' })
                    const disposition = resp.headers['content-disposition'] || ''
                    const match = disposition.match(/filename="?([^"]+)"?/)
                    const filename = match ? match[1] : doc.title || 'download'
                    const url = URL.createObjectURL(resp.data)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = filename
                    a.click()
                    URL.revokeObjectURL(url)
                  } catch {
                    toast.error('下载失败')
                  }
                }}
                className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm hover:bg-indigo-100 transition-colors"
              >
                <Download size={14} />
                下载文件
              </button>
            </div>
          )}
          {doc.source_type === 'cloud' && (
            <div>
              <p className="text-sm text-gray-500 mb-1">文档链接</p>
              <div className="flex flex-wrap gap-2">
                {doc.doc_url && (
                  <a
                    href={doc.doc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors"
                  >
                    <ExternalLink size={14} />
                    在飞书中打开
                  </a>
                )}
                {doc.bitable_url && (
                  <a
                    href={doc.bitable_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100 transition-colors"
                  >
                    <ExternalLink size={14} />
                    查看源多维表格
                  </a>
                )}
              </div>
            </div>
          )}

          {doc.summary && (
            <div>
              <p className="text-sm text-gray-500 mb-1">摘要</p>
              <p className="text-sm text-gray-800 bg-blue-50 rounded-lg p-3">{doc.summary}</p>
            </div>
          )}
          <div>
            <p className="text-sm text-gray-500 mb-1">内容</p>
            <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">
              {doc.content_text}
            </div>
          </div>
          {doc.tags && Object.keys(doc.tags).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">标签</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(doc.tags).map((tag) => (
                  <span key={tag} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs">{tag}</span>
                ))}
              </div>
            </div>
          )}
          <AttachmentsAndLinks extraFields={doc.extra_fields} />
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-gray-500 flex items-center gap-1">{icon}{label}</p>
      <p className="text-sm text-gray-800 font-medium">{value}</p>
    </div>
  )
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']

function isImage(name: string, type: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.includes(ext) || type.startsWith('image/')
}

function AttachmentsAndLinks({ extraFields }: { extraFields?: DocumentItem['extra_fields'] }) {
  const [preview, setPreview] = useState<string | null>(null)
  const attachments = extraFields?._attachments || []
  const links = extraFields?._links || []

  if (attachments.length === 0 && links.length === 0) return null

  return (
    <>
      {attachments.length > 0 && (
        <div>
          <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><Paperclip size={14} /> 附件</p>
          <div className="grid grid-cols-2 gap-2">
            {attachments.map((att) =>
              isImage(att.name, att.type) ? (
                <div key={att.file_token} className="relative group cursor-pointer" onClick={() => setPreview(`/api/upload/attachments/${att.file_token}`)}>
                  <img
                    src={`/api/upload/attachments/${att.file_token}`}
                    alt={att.name}
                    className="w-full h-32 object-cover rounded-lg border border-gray-200"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                    <Image size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">{att.name}</p>
                </div>
              ) : (
                <a
                  key={att.file_token}
                  href={`/api/upload/attachments/${att.file_token}`}
                  download
                  className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Download size={16} className="text-gray-400 shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{att.name || att.file_token}</span>
                </a>
              )
            )}
          </div>
        </div>
      )}

      {links.length > 0 && (
        <div>
          <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><ExternalLink size={14} /> 超链接</p>
          <div className="space-y-1">
            {links.map((lnk, i) => (
              <a
                key={i}
                href={lnk.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                <ExternalLink size={14} className="shrink-0" />
                {lnk.text || lnk.field_name || lnk.link}
              </a>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center" onClick={() => setPreview(null)}>
          <img src={preview} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  )
}
