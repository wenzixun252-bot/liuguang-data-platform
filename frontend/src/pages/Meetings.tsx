import { useEffect, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, X, Clock, MapPin, Users, Paperclip, ExternalLink, Download, Image, FileText, User, Trash2 } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { ColumnSettingsButton, useColumnSettings, type ColumnDef } from '../components/ColumnSettings'
import { getUser } from '../lib/auth'

const MEETING_COLUMNS: ColumnDef[] = [
  { key: 'title', label: '主题' },
  { key: 'meeting_time', label: '时间' },
  { key: 'organizer', label: '组织者' },
  { key: 'uploader_name', label: '上传人' },
  { key: 'duration', label: '时长', defaultVisible: false },
  { key: 'location', label: '地点', defaultVisible: false },
  { key: 'participants', label: '参会人', defaultVisible: false },
  { key: 'conclusions', label: '结论', defaultVisible: false },
  { key: 'minutes_url', label: '会议纪要', defaultVisible: false },
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

interface MeetingItem {
  id: number
  owner_id: string
  source_app_token: string | null
  source_table_id: string | null
  title: string | null
  meeting_time: string | null
  duration_minutes: number | null
  location: string | null
  organizer: string | null
  participants: { name?: string; open_id?: string }[]
  agenda: string | null
  conclusions: string | null
  action_items: { task?: string; assignee?: string; deadline?: string }[]
  content_text: string
  minutes_url: string | null
  uploader_name: string | null
  extra_fields?: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  bitable_url: string | null
  created_at: string
}

interface MeetingListResponse {
  items: MeetingItem[]
  total: number
  page: number
  page_size: number
}

export default function Meetings() {
  const [data, setData] = useState<MeetingListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [organizerFilter, setOrganizerFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selected, setSelected] = useState<MeetingItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const { isVisible, toggle, columns: colDefs } = useColumnSettings('meetings', MEETING_COLUMNS)

  const pageSize = 20

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (organizerFilter) params.organizer = organizerFilter
    if (startDate) params.start_date = new Date(startDate).toISOString()
    if (endDate) params.end_date = new Date(endDate + 'T23:59:59').toISOString()

    api.get('/meetings/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载会议列表失败'))
      .finally(() => setLoading(false))
  }, [page, search, organizerFilter, startDate, endDate, refreshKey])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, search, organizerFilter, startDate, endDate])

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0
  const currentIds = data?.items.map((i) => i.id) || []
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
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 条数据吗？`)) return
    try {
      const res = await api.post('/meetings/batch-delete', { ids: Array.from(selectedIds) })
      toast.success(`已删除 ${res.data.deleted} 条`)
      setSelectedIds(new Set())
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error('批量删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">会议</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索会议..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <input
            type="text"
            placeholder="组织者筛选"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-32 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={organizerFilter}
            onChange={(e) => { setOrganizerFilter(e.target.value); setPage(1) }}
          />
          <input
            type="date"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
            title="开始日期"
          />
          <input
            type="date"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
            title="结束日期"
          />
          <ColumnSettingsButton columns={colDefs} isVisible={isVisible} toggle={toggle} />
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
        ) : data && data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3 px-4 w-10">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded" />
                    </th>
                    {isVisible('title') && <th className="text-left py-3 px-4 text-gray-500 font-medium">主题</th>}
                    {isVisible('meeting_time') && <th className="text-left py-3 px-4 text-gray-500 font-medium">时间</th>}
                    {isVisible('organizer') && <th className="text-left py-3 px-4 text-gray-500 font-medium">组织者</th>}
                    {isVisible('uploader_name') && <th className="text-left py-3 px-4 text-gray-500 font-medium">上传人</th>}
                    {isVisible('duration') && <th className="text-left py-3 px-4 text-gray-500 font-medium">时长</th>}
                    {isVisible('location') && <th className="text-left py-3 px-4 text-gray-500 font-medium">地点</th>}
                    {isVisible('participants') && <th className="text-left py-3 px-4 text-gray-500 font-medium">参会人</th>}
                    {isVisible('conclusions') && <th className="text-left py-3 px-4 text-gray-500 font-medium">结论</th>}
                    {isVisible('minutes_url') && <th className="text-left py-3 px-4 text-gray-500 font-medium">会议纪要</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-t border-gray-50 hover:bg-indigo-50/50 cursor-pointer transition-colors ${selectedIds.has(item.id) ? 'bg-indigo-50/30' : ''}`}
                      onClick={() => setSelected(item)}
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded" />
                      </td>
                      {isVisible('title') && <td className="py-3 px-4 text-gray-800 font-medium">{item.title || '无标题'}</td>}
                      {isVisible('meeting_time') && <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{item.meeting_time ? new Date(item.meeting_time).toLocaleString('zh-CN') : '-'}</td>}
                      {isVisible('organizer') && <td className="py-3 px-4 text-gray-500">{item.organizer || '-'}</td>}
                      {isVisible('uploader_name') && <td className="py-3 px-4 text-gray-500">{item.uploader_name || '-'}</td>}
                      {isVisible('duration') && <td className="py-3 px-4 text-gray-500">{item.duration_minutes ? `${item.duration_minutes} 分钟` : '-'}</td>}
                      {isVisible('location') && <td className="py-3 px-4 text-gray-500 truncate max-w-[200px]">{item.location || '-'}</td>}
                      {isVisible('participants') && <td className="py-3 px-4 text-gray-500">{item.participants.length > 0 ? `${item.participants.length} 人` : '-'}</td>}
                      {isVisible('conclusions') && <td className="py-3 px-4 text-gray-500 max-w-[250px] truncate">{item.conclusions || '-'}</td>}
                      {isVisible('minutes_url') && (
                        <td className="py-3 px-4">
                          {item.minutes_url ? (
                            <a
                              href={item.minutes_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:text-indigo-800 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <FileText size={16} />
                            </a>
                          ) : '-'}
                        </td>
                      )}
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
          <div className="p-12 text-center text-gray-400">暂无会议记录</div>
        )}
      </div>

      {selected && <MeetingDetail meeting={selected} onClose={() => setSelected(null)} onDelete={async (id) => {
        if (!confirm('确定要删除这条数据吗？')) return
        try {
          await api.delete(`/meetings/${id}`)
          toast.success('已删除')
          setSelected(null)
          setRefreshKey((k) => k + 1)
        } catch { toast.error('删除失败') }
      }} />}
    </div>
  )
}

function MeetingDetail({ meeting, onClose, onDelete }: { meeting: MeetingItem; onClose: () => void; onDelete: (id: number) => void }) {
  const currentUser = getUser()
  const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.feishu_open_id === meeting.owner_id)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">会议详情</h2>
          <div className="flex items-center gap-2">
            {canDelete && (
              <button onClick={() => onDelete(meeting.id)} className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-700" title="删除">
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-800">{meeting.title || '无标题'}</h3>

          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            {meeting.meeting_time && (
              <span className="flex items-center gap-1">
                <Clock size={14} />
                {new Date(meeting.meeting_time).toLocaleString('zh-CN')}
                {meeting.duration_minutes && ` (${meeting.duration_minutes}分钟)`}
              </span>
            )}
            {meeting.location && (
              <span className="flex items-center gap-1">
                <MapPin size={14} />
                {meeting.location}
              </span>
            )}
          </div>

          {meeting.uploader_name && <Field label="上传人" value={meeting.uploader_name} icon={<User size={14} />} />}
          {meeting.organizer && <Field label="组织者" value={meeting.organizer} />}

          {/* 链接 */}
          {(meeting.minutes_url || meeting.bitable_url) && (
            <div>
              <p className="text-sm text-gray-500 mb-1">相关链接</p>
              <div className="flex flex-wrap gap-2">
                {meeting.minutes_url && (
                  <a
                    href={meeting.minutes_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors"
                  >
                    <FileText size={14} />
                    查看完整纪要
                  </a>
                )}
                {meeting.bitable_url && (
                  <a
                    href={meeting.bitable_url}
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

          {meeting.participants.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1 flex items-center gap-1"><Users size={14} /> 参与人</p>
              <div className="flex flex-wrap gap-2">
                {meeting.participants.map((p, i) => (
                  <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
                    {p.name || p.open_id || '未知'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {meeting.agenda && (
            <div>
              <p className="text-sm text-gray-500 mb-1">议程</p>
              <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{meeting.agenda}</p>
            </div>
          )}

          {meeting.conclusions && (
            <div>
              <p className="text-sm text-gray-500 mb-1">结论</p>
              <p className="text-sm text-gray-800 bg-green-50 rounded-lg p-3 whitespace-pre-wrap">{meeting.conclusions}</p>
            </div>
          )}

          {meeting.action_items.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">待办事项</p>
              <ul className="space-y-2">
                {meeting.action_items.map((item, i) => (
                  <li key={i} className="text-sm bg-yellow-50 rounded-lg p-3">
                    <p className="text-gray-800">{item.task || '未命名任务'}</p>
                    {item.assignee && <p className="text-gray-500 text-xs mt-1">负责人: {item.assignee}</p>}
                    {item.deadline && <p className="text-gray-500 text-xs">截止: {item.deadline}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-sm text-gray-500 mb-1">全文内容</p>
            <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">
              {meeting.content_text}
            </div>
          </div>
          <AttachmentsAndLinks extraFields={meeting.extra_fields} />
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

function AttachmentsAndLinks({ extraFields }: { extraFields?: MeetingItem['extra_fields'] }) {
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
