import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, X, Clock, MapPin, Users, Paperclip, ExternalLink, Download, Image, FileText, User, Trash2, Settings, MessageSquare, Video, Mic } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { ColumnSettingsButton, useColumnSettings, type ColumnDef } from '../components/ColumnSettings'
import { getUser } from '../lib/auth'
import RecipeSyncConfig from '../components/RecipeSyncConfig'
import { TagChips, TagFilter, BatchTagBar, useContentTags, InlineTagEditor } from '../components/TagManager'

// ─── 类型切换选项 ───────────────────────────────────────────
type CommTypeFilter = 'all' | 'meeting' | 'chat'

const COMM_TYPE_OPTIONS: { value: CommTypeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'meeting', label: '会议（含录音）' },
  { value: 'chat', label: '会话' },
]

// ─── 列定义 ────────────────────────────────────────────────
const COMMON_COLUMNS: ColumnDef[] = [
  { key: 'title', label: '主题' },
  { key: 'tags', label: '标签' },
  { key: 'comm_time', label: '会议时间/发送时间' },
  { key: 'initiator', label: '组织者/发送者' },
  { key: 'keywords', label: '关键词', defaultVisible: false },
  { key: 'uploader_name', label: '上传人', defaultVisible: false },
]

const MEETING_EXTRA_COLUMNS: ColumnDef[] = [
  { key: 'duration', label: '时长', defaultVisible: false },
  { key: 'location', label: '地点', defaultVisible: false },
  { key: 'participants', label: '参与人/提及人', defaultVisible: false },
  { key: 'conclusions', label: '结论', defaultVisible: false },
  { key: 'source_url', label: '会议纪要', defaultVisible: false },
]

const CHAT_EXTRA_COLUMNS: ColumnDef[] = [
  { key: 'chat_name', label: '群组名称' },
  { key: 'content', label: '内容预览' },
]

function getColumnsForType(commType: CommTypeFilter): ColumnDef[] {
  switch (commType) {
    case 'meeting':
      return [...COMMON_COLUMNS, ...MEETING_EXTRA_COLUMNS]
    case 'chat':
      return [...COMMON_COLUMNS, ...CHAT_EXTRA_COLUMNS]
    default:
      return [...COMMON_COLUMNS, ...MEETING_EXTRA_COLUMNS, ...CHAT_EXTRA_COLUMNS]
  }
}

// ─── 接口类型 ──────────────────────────────────────────────
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

interface CommunicationItem {
  id: number
  owner_id: string
  comm_type: string
  source_platform: string | null
  source_app_token: string
  source_table_id: string | null
  feishu_record_id: string
  title: string | null
  comm_time: string | null
  initiator: string | null
  participants: { name?: string; open_id?: string }[]
  duration_minutes: number | null
  location: string | null
  agenda: string | null
  conclusions: string | null
  action_items: { task?: string; assignee?: string; deadline?: string }[]
  transcript: string | null
  recording_url: string | null
  chat_id: string | null
  chat_type: string | null
  chat_name: string | null
  message_type: string | null
  reply_to: string | null
  content_text: string
  summary: string | null
  source_url: string | null
  uploader_name: string | null
  keywords: string[]
  sentiment: string | null
  quality_score: number | null
  duplicate_of: number | null
  extra_fields: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  feishu_created_at: string | null
  feishu_updated_at: string | null
  parse_status: string
  processed_at: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
}

interface CommunicationListResponse {
  items: CommunicationItem[]
  total: number
  page: number
  page_size: number
}

// ─── 类型标识组件 ──────────────────────────────────────────
function CommTypeBadge({ type }: { type: string }) {
  switch (type) {
    case 'meeting':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
          <Video size={12} />
          会议
        </span>
      )
    case 'recording':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-medium">
          <Mic size={12} />
          录音
        </span>
      )
    case 'chat':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium">
          <MessageSquare size={12} />
          会话
        </span>
      )
    default:
      return <span className="px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded text-xs">{type}</span>
  }
}

// ─── 主组件 ────────────────────────────────────────────────
export default function Communications() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<CommunicationListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [initiatorFilter, setInitiatorFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [commTypeFilter, setCommTypeFilter] = useState<CommTypeFilter>('all')
  const [selected, setSelected] = useState<CommunicationItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [showSyncConfig, setShowSyncConfig] = useState(false)
  const [tagFilter, setTagFilter] = useState<number[]>([])
  const [tagRefreshKey, setTagRefreshKey] = useState(0)

  const activeColumns = getColumnsForType(commTypeFilter)
  const { isVisible, toggle, columns: colDefs } = useColumnSettings('communications', activeColumns)

  const pageSize = 20

  // 加载数据
  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (initiatorFilter) params.initiator = initiatorFilter
    if (startDate) params.start_date = new Date(startDate).toISOString()
    if (endDate) params.end_date = new Date(endDate + 'T23:59:59').toISOString()
    if (tagFilter.length > 0) params.tag_ids = tagFilter

    // 类型筛选：会议（含录音）传 meeting，后端会同时覆盖 recording 类型的处理
    if (commTypeFilter === 'meeting') params.comm_type = 'meeting'
    else if (commTypeFilter === 'chat') params.comm_type = 'chat'

    api.get('/communications/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载沟通记录失败'))
      .finally(() => setLoading(false))
  }, [page, search, initiatorFilter, startDate, endDate, commTypeFilter, tagFilter, refreshKey])

  // 切换筛选条件时清空选择
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, search, initiatorFilter, startDate, endDate, commTypeFilter, tagFilter])

  // 从搜索结果跳转过来时自动打开详情
  useEffect(() => {
    const highlightId = searchParams.get('highlight')
    if (highlightId && data?.items) {
      const item = data.items.find(i => i.id === Number(highlightId))
      if (item) {
        setSelected(item)
        setSearchParams({}, { replace: true })
      }
    }
  }, [data, searchParams, setSearchParams])

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0
  const currentIds = data?.items.map((i) => i.id) || []
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id))
  const { tagsMap, reloadTags } = useContentTags('communication', currentIds, tagRefreshKey)

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
      const res = await api.post('/communications/batch-delete', { ids: Array.from(selectedIds) })
      toast.success(`已删除 ${res.data.deleted} 条`)
      setSelectedIds(new Set())
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error('批量删除失败')
    }
  }

  const handleCommTypeChange = (type: CommTypeFilter) => {
    setCommTypeFilter(type)
    setPage(1)
  }

  // 导入配置参数：根据当前筛选类型显示不同配置
  const syncConfigProps = commTypeFilter === 'chat'
    ? {
        title: '会话记录导入配置',
        recipeUrl: 'https://recipes.feishu.cn/recipe?template_id=36&ref=share',
        assetType: 'chat_message' as const,
        recipeKeywords: ['群聊摘要', '消息汇总', 'Chat', '聊天记录', '群消息'],
        steps: [
          '点击下方按钮打开飞书工作配方页面',
          '在飞书中启用配方，它会自动把会话记录写入一个多维表格',
          '回到流光，系统会自动检索到配方创建的表格，确认关联即可',
        ],
      }
    : {
        title: '会议记录导入配置',
        recipeUrl: 'https://recipes.feishu.cn/recipe?template_id=32',
        assetType: 'meeting' as const,
        recipeKeywords: ['会议纪要', '会议记录', 'Meeting', '会议摘要'],
        steps: [
          '点击下方按钮打开飞书工作配方页面',
          '在飞书中启用配方，它会自动把会议记录写入一个多维表格',
          '回到流光，系统会自动检索到配方创建的表格，确认关联即可',
        ],
      }

  return (
    <div className="space-y-4">
      {/* 页面标题和工具栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">沟通资产</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowSyncConfig(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
          >
            <Settings size={16} />
            导入配置
          </button>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索沟通记录..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <input
            type="text"
            placeholder="组织者/发送者筛选"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-40 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={initiatorFilter}
            onChange={(e) => { setInitiatorFilter(e.target.value); setPage(1) }}
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

      {/* comm_type 切换器 */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {COMM_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleCommTypeChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              commTypeFilter === opt.value
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 标签筛选 */}
      <TagFilter selectedTagIds={tagFilter} onChange={(ids) => { setTagFilter(ids); setPage(1) }} />

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg flex-wrap">
          <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 项</span>
          <BatchTagBar
            selectedIds={selectedIds}
            contentType="communication"
            onDone={() => setRefreshKey((k) => k + 1)}
          />
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

      {/* 数据表格 */}
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
                    {/* 全部模式下显示类型标识列 */}
                    {commTypeFilter === 'all' && <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>}
                    {isVisible('title') && <th className="text-left py-3 px-4 text-gray-500 font-medium">主题</th>}
                    {isVisible('tags') && <th className="text-left py-3 px-4 text-gray-500 font-medium">标签</th>}
                    {isVisible('keywords') && <th className="text-left py-3 px-4 text-gray-500 font-medium">关键词</th>}
                    {isVisible('comm_time') && <th className="text-left py-3 px-4 text-gray-500 font-medium">会议时间/发送时间</th>}
                    {isVisible('initiator') && <th className="text-left py-3 px-4 text-gray-500 font-medium">组织者/发送者</th>}
                    {isVisible('uploader_name') && <th className="text-left py-3 px-4 text-gray-500 font-medium">上传人</th>}
                    {isVisible('duration') && <th className="text-left py-3 px-4 text-gray-500 font-medium">时长</th>}
                    {isVisible('location') && <th className="text-left py-3 px-4 text-gray-500 font-medium">地点</th>}
                    {isVisible('participants') && <th className="text-left py-3 px-4 text-gray-500 font-medium">参与人/提及人</th>}
                    {isVisible('conclusions') && <th className="text-left py-3 px-4 text-gray-500 font-medium">结论</th>}
                    {isVisible('source_url') && <th className="text-left py-3 px-4 text-gray-500 font-medium">会议纪要</th>}
                    {isVisible('chat_name') && <th className="text-left py-3 px-4 text-gray-500 font-medium">群组名称</th>}
                    {isVisible('content') && <th className="text-left py-3 px-4 text-gray-500 font-medium">内容预览</th>}
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
                      {commTypeFilter === 'all' && (
                        <td className="py-3 px-4">
                          <CommTypeBadge type={item.comm_type} />
                        </td>
                      )}
                      {isVisible('title') && <td className="py-3 px-4 text-gray-800 font-medium">{item.title || '无标题'}</td>}
                      {isVisible('tags') && (
                        <td className="py-3 px-4 max-w-[200px]">
                          <InlineTagEditor
                            contentType="communication"
                            contentId={item.id}
                            tags={tagsMap[item.id] || []}
                            onChanged={() => { reloadTags(); setTagRefreshKey(k => k + 1) }}
                          />
                        </td>
                      )}
                      {isVisible('keywords') && (
                        <td className="py-3 px-4 max-w-[200px]">
                          <div className="flex flex-wrap gap-1">
                            {(item.keywords || []).slice(0, 3).map((kw, i) => (
                              <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{kw}</span>
                            ))}
                            {(item.keywords || []).length > 3 && (
                              <span className="px-1.5 py-0.5 text-gray-400 text-xs">+{item.keywords.length - 3}</span>
                            )}
                          </div>
                        </td>
                      )}
                      {isVisible('comm_time') && (
                        <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                          {item.comm_time ? new Date(item.comm_time).toLocaleString('zh-CN') : '-'}
                        </td>
                      )}
                      {isVisible('initiator') && <td className="py-3 px-4 text-gray-500">{item.initiator || '-'}</td>}
                      {isVisible('uploader_name') && <td className="py-3 px-4 text-gray-500">{item.uploader_name || '-'}</td>}
                      {isVisible('duration') && (
                        <td className="py-3 px-4 text-gray-500">
                          {item.duration_minutes ? `${item.duration_minutes} 分钟` : '-'}
                        </td>
                      )}
                      {isVisible('location') && <td className="py-3 px-4 text-gray-500 truncate max-w-[200px]">{item.location || '-'}</td>}
                      {isVisible('participants') && (
                        <td className="py-3 px-4 text-gray-500">
                          {item.participants.length > 0 ? `${item.participants.length} 人` : '-'}
                        </td>
                      )}
                      {isVisible('conclusions') && <td className="py-3 px-4 text-gray-500 max-w-[250px] truncate">{item.conclusions || '-'}</td>}
                      {isVisible('source_url') && (
                        <td className="py-3 px-4">
                          {item.source_url ? (
                            <a
                              href={item.source_url}
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
                      {isVisible('chat_name') && <td className="py-3 px-4 text-gray-500">{item.chat_name || (item.comm_type === 'chat' ? '个人聊天' : '-')}</td>}
                      {isVisible('content') && <td className="py-3 px-4 text-gray-500 max-w-xs truncate">{item.content_text?.slice(0, 80)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
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
          <div className="p-12 text-center text-gray-400">暂无沟通记录</div>
        )}
      </div>

      {/* 导入配置弹窗 */}
      {showSyncConfig && (
        <RecipeSyncConfig
          {...syncConfigProps}
          onClose={() => setShowSyncConfig(false)}
          onSyncComplete={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* 详情侧栏 */}
      {selected && (
        <CommunicationDetail
          item={selected}
          onClose={() => setSelected(null)}
          onDelete={async (id) => {
            if (!confirm('确定要删除这条数据吗？')) return
            try {
              await api.delete(`/communications/${id}`)
              toast.success('已删除')
              setSelected(null)
              setRefreshKey((k) => k + 1)
            } catch {
              toast.error('删除失败')
            }
          }}
        />
      )}
    </div>
  )
}

// ─── 详情侧栏 ──────────────────────────────────────────────
function CommunicationDetail({
  item,
  onClose,
  onDelete,
}: {
  item: CommunicationItem
  onClose: () => void
  onDelete: (id: number) => void
}) {
  const currentUser = getUser()
  const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.feishu_open_id === item.owner_id)
  const isMeetingLike = item.comm_type === 'meeting' || item.comm_type === 'recording'
  const isChat = item.comm_type === 'chat'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* 顶栏 */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800">
              {isMeetingLike ? '会议详情' : '消息详情'}
            </h2>
            <CommTypeBadge type={item.comm_type} />
          </div>
          <div className="flex items-center gap-2">
            {canDelete && (
              <button onClick={() => onDelete(item.id)} className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-700" title="删除">
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* 标题 */}
          <h3 className="text-lg font-semibold text-gray-800">{item.title || '无标题'}</h3>

          {/* 标签 */}
          <div>
            <p className="text-sm text-gray-500 mb-1">标签</p>
            <TagChips contentType="communication" contentId={item.id} editable />
          </div>

          {/* 关键词 */}
          {item.keywords && item.keywords.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">关键词</p>
              <div className="flex flex-wrap gap-1.5">
                {item.keywords.map((kw, i) => (
                  <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {/* 时间和地点 (会议类) */}
          {isMeetingLike && (
            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
              {item.comm_time && (
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {new Date(item.comm_time).toLocaleString('zh-CN')}
                  {item.duration_minutes && ` (${item.duration_minutes}分钟)`}
                </span>
              )}
              {item.location && (
                <span className="flex items-center gap-1">
                  <MapPin size={14} />
                  {item.location}
                </span>
              )}
            </div>
          )}

          {/* 会话类的基础信息 */}
          {isChat && (
            <>
              {item.initiator && <Field label="发送者" value={item.initiator} />}
              <Field label="群组名称" value={item.chat_name || '个人聊天'} />
              {item.comm_time && <Field label="发送时间" value={new Date(item.comm_time).toLocaleString('zh-CN')} />}
              {item.reply_to && <Field label="回复" value={item.reply_to} />}
            </>
          )}

          {/* 会议类的组织者 */}
          {isMeetingLike && item.initiator && <Field label="组织者" value={item.initiator} />}

          {/* 上传人 */}
          {item.uploader_name && <Field label="上传人" value={item.uploader_name} icon={<User size={14} />} />}

          {/* 相关链接 */}
          {(item.source_url || item.recording_url || item.extra_fields?.bitable_url) && (
            <div>
              <p className="text-sm text-gray-500 mb-1">相关链接</p>
              <div className="flex flex-wrap gap-2">
                {item.source_url && (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors"
                  >
                    <FileText size={14} />
                    查看完整纪要
                  </a>
                )}
                {item.recording_url && (
                  <a
                    href={item.recording_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-orange-50 text-orange-700 rounded-lg text-sm hover:bg-orange-100 transition-colors"
                  >
                    <Mic size={14} />
                    查看录音
                  </a>
                )}
                {(item.extra_fields as Record<string, unknown>)?.bitable_url && (
                  <a
                    href={(item.extra_fields as Record<string, unknown>).bitable_url as string}
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

          {/* 参与人（会议类） */}
          {isMeetingLike && item.participants.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1 flex items-center gap-1"><Users size={14} /> 参与人</p>
              <div className="flex flex-wrap gap-2">
                {item.participants.map((p, i) => (
                  <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
                    {p.name || p.open_id || '未知'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 提及人（会话类） */}
          {isChat && item.participants.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">提及</p>
              <div className="flex flex-wrap gap-2">
                {item.participants.map((m, i) => (
                  <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
                    @{m.name || m.open_id || '未知'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 议程（会议类） */}
          {isMeetingLike && item.agenda && (
            <div>
              <p className="text-sm text-gray-500 mb-1">议程</p>
              <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{item.agenda}</p>
            </div>
          )}

          {/* 结论（会议类） */}
          {isMeetingLike && item.conclusions && (
            <div>
              <p className="text-sm text-gray-500 mb-1">结论</p>
              <p className="text-sm text-gray-800 bg-green-50 rounded-lg p-3 whitespace-pre-wrap">{item.conclusions}</p>
            </div>
          )}

          {/* 待办事项（会议类） */}
          {isMeetingLike && item.action_items.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">待办事项</p>
              <ul className="space-y-2">
                {item.action_items.map((ai, i) => (
                  <li key={i} className="text-sm bg-yellow-50 rounded-lg p-3">
                    <p className="text-gray-800">{ai.task || '未命名任务'}</p>
                    {ai.assignee && <p className="text-gray-500 text-xs mt-1">负责人: {ai.assignee}</p>}
                    {ai.deadline && <p className="text-gray-500 text-xs">截止: {ai.deadline}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 会议转录（会议/录音类） */}
          {isMeetingLike && item.transcript && (
            <div>
              <p className="text-sm text-gray-500 mb-1">会议转录</p>
              <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-60 overflow-y-auto">
                {item.transcript}
              </div>
            </div>
          )}

          {/* 摘要 */}
          {item.summary && (
            <div>
              <p className="text-sm text-gray-500 mb-1">摘要</p>
              <p className="text-sm text-gray-800 bg-indigo-50 rounded-lg p-3 whitespace-pre-wrap">{item.summary}</p>
            </div>
          )}

          {/* 全文内容 */}
          <div>
            <p className="text-sm text-gray-500 mb-1">全文内容</p>
            <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">
              {item.content_text}
            </div>
          </div>

          {/* 附件和链接 */}
          <AttachmentsAndLinks extraFields={item.extra_fields} />
        </div>
      </div>
    </div>
  )
}

// ─── 辅助组件 ──────────────────────────────────────────────
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

function AttachmentsAndLinks({ extraFields }: { extraFields?: CommunicationItem['extra_fields'] }) {
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
