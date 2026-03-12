import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, X, Clock, MapPin, Users, Paperclip, ExternalLink, Download, Image, FileText, Trash2, MessageSquare, Video, Mic, Table2, Upload } from 'lucide-react'
import api, { getExtractionRules } from '../lib/api'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { ColumnSettingsButton, useColumnSettings, type ColumnDef } from '../components/ColumnSettings'
import { getUser } from '../lib/auth'
import { TagChips, BatchTagBar, useContentTags, InlineTagEditor, TagFilter } from '../components/TagManager'
import { ColumnFilter } from '../components/ColumnFilter'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { HighlightText } from '../components/HighlightText'

// ─── 类型切换选项 ───────────────────────────────────────────
type CommTypeFilter = 'meeting' | 'chat'

const COMM_TYPE_OPTIONS: { value: CommTypeFilter; label: string }[] = [
  { value: 'meeting', label: '会议（含录音）' },
  { value: 'chat', label: '会话' },
]

// ─── 列定义（会议和会话各自只保留重要字段）─────────────────
const MEETING_COLUMNS: ColumnDef[] = [
  { key: 'title', label: '主题' },
  { key: 'tags', label: '标签' },
  { key: 'comm_time', label: '会议时间' },
  { key: 'initiator', label: '组织者' },
  { key: 'participants', label: '参与人' },
  { key: 'key_info', label: '自定义提取内容' },
  { key: 'content', label: '内容预览' },
  { key: 'source_url', label: '会议纪要', defaultVisible: false },
  { key: 'duration', label: '时长', defaultVisible: false },
  { key: 'location', label: '地点', defaultVisible: false },
  { key: 'keywords', label: '关键词', defaultVisible: false },
]

const CHAT_COLUMNS: ColumnDef[] = [
  { key: 'tags', label: '标签' },
  { key: 'comm_time', label: '发送时间' },
  { key: 'initiator', label: '发送者' },
  { key: 'chat_name', label: '群组名称' },
  { key: 'key_info', label: '自定义提取内容' },
  { key: 'content', label: '发送内容' },
  { key: 'attachments', label: '附件' },
  { key: 'keywords', label: '关键词', defaultVisible: false },
]

function getColumnsForType(commType: CommTypeFilter): ColumnDef[] {
  return commType === 'meeting' ? MEETING_COLUMNS : CHAT_COLUMNS
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
  key_info?: Record<string, string> | null
  extraction_rule_id?: number | null
  extra_fields: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  feishu_created_at: string | null
  feishu_updated_at: string | null
  matched_fields: string[]
  parse_status: string
  processed_at: string | null
  synced_at: string | null
  bitable_url: string | null
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<CommunicationListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({})
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({})
  const [tagIds, setTagIds] = useState<number[]>([])
  const [commTypeFilter, setCommTypeFilter] = useState<CommTypeFilter>('meeting')
  const [selected, setSelected] = useState<CommunicationItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [tagRefreshKey, setTagRefreshKey] = useState(0)

  // 提取规则名称映射
  const { data: rulesList } = useQuery({ queryKey: ['extraction-rules'], queryFn: getExtractionRules })
  const rulesMap: Record<number, string> = {}
  if (Array.isArray(rulesList)) {
    rulesList.forEach((r: any) => { rulesMap[r.id] = r.name })
  }

  const activeColumns = getColumnsForType(commTypeFilter)
  const { isVisible, toggle, columns: colDefs } = useColumnSettings(`comm-${commTypeFilter}`, activeColumns)

  const pageSize = 20

  // 后端支持的筛选参数
  const backendFilterKeys = ['initiator']

  // 加载数据
  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    params.comm_type = commTypeFilter
    if (tagIds.length > 0) params.tag_ids = tagIds
    for (const [key, vals] of Object.entries(columnFilters)) {
      if (vals.length > 0 && backendFilterKeys.includes(key)) params[key] = vals.join(',')
    }
    // 时间筛选
    if (dateFilters.comm_time?.from) params.start_date = dateFilters.comm_time.from + 'T00:00:00'
    if (dateFilters.comm_time?.to) params.end_date = dateFilters.comm_time.to + 'T23:59:59'

    api.get('/communications/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载沟通记录失败'))
      .finally(() => setLoading(false))
  }, [page, search, commTypeFilter, columnFilters, dateFilters, tagIds, refreshKey])

  // 切换筛选条件时清空选择
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, search, commTypeFilter, columnFilters, dateFilters, tagIds])

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

  // 从当前页数据提取唯一值用于列筛选
  const uniqueValues = (key: string) => {
    if (!data?.items) return []
    const vals = new Set<string>()
    for (const item of data.items) {
      if (key === 'participants') {
        for (const p of item.participants || []) {
          const name = p.name || p.open_id
          if (name) vals.add(name)
        }
      } else if (key === 'chat_name') {
        vals.add(item.chat_name || '个人聊天')
      } else {
        const v = (item as unknown as Record<string, unknown>)[key]
        if (v != null && v !== '') vals.add(String(v))
      }
    }
    return Array.from(vals).sort()
  }
  // 可筛选列（key -> 匹配方式）
  const filterableColumns = ['initiator', 'chat_name', 'participants', 'location']
  const updateColumnFilter = (key: string, vals: string[]) => {
    setColumnFilters((prev) => {
      const next = { ...prev }
      if (vals.length === 0) delete next[key]
      else next[key] = vals
      return next
    })
    setPage(1)
  }
  const updateDateFilter = (field: string, from: string, to: string) => {
    setDateFilters((prev) => {
      const next = { ...prev }
      if (!from && !to) delete next[field]
      else next[field] = { from, to }
      return next
    })
    setPage(1)
  }

  // 前端本地过滤（对后端不支持的筛选字段）
  const filteredItems = (() => {
    if (!data?.items) return []
    let items = data.items
    for (const [key, vals] of Object.entries(columnFilters)) {
      if (vals.length === 0 || backendFilterKeys.includes(key)) continue
      items = items.filter((item) => {
        if (key === 'participants') {
          return (item.participants || []).some((p) => vals.includes(p.name || ''))
        }
        if (key === 'chat_name') {
          return vals.includes(item.chat_name || '个人聊天')
        }
        if (key === 'location') {
          return vals.includes(item.location || '')
        }
        return true
      })
    }
    return items
  })()

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0
  const currentIds = filteredItems.map((i) => i.id)
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

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条数据吗？')) return
    try {
      await api.delete(`/communications/${id}`)
      toast.success('已删除')
      if (selected?.id === id) setSelected(null)
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error('删除失败')
    }
  }

  const handleCommTypeChange = (type: CommTypeFilter) => {
    setCommTypeFilter(type)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {/* 页面标题和工具栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">沟通资产</h1>
          <button
            type="button"
            onClick={() => navigate('/data-import')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Upload size={14} />
            导入数据
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索主题、内容、摘要、组织者..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
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

      {/* 标签切片器 */}
      <TagFilter
        selectedTagIds={tagIds}
        onChange={(ids) => { setTagIds(ids); setPage(1) }}
      />

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
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3 px-4 w-10">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded" />
                    </th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>
                    {colDefs.filter(c => isVisible(c.key)).map(c => (
                      <th key={c.key} className={`text-left py-3 px-4 font-medium ${c.key === 'key_info' ? 'text-violet-700 font-semibold bg-violet-50/50' : 'text-gray-500'}`}>
                        <span className="inline-flex items-center gap-1">
                          {c.label}
                          {filterableColumns.includes(c.key) && (
                            <ColumnFilter options={uniqueValues(c.key)} selected={columnFilters[c.key] || []} onChange={(v) => updateColumnFilter(c.key, v)} />
                          )}
                          {c.key === 'comm_time' && (
                            <DateRangeFilter from={dateFilters.comm_time?.from || ''} to={dateFilters.comm_time?.to || ''} onChange={(f, t) => updateDateFilter('comm_time', f, t)} />
                          )}
                        </span>
                      </th>
                    ))}
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length > 0 ? filteredItems.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-t border-gray-50 hover:bg-indigo-50/50 cursor-pointer transition-colors ${selectedIds.has(item.id) ? 'bg-indigo-50/30' : ''}`}
                      onClick={() => setSelected(item)}
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded" />
                      </td>
                      <td className="py-3 px-4">
                        <CommTypeBadge type={item.comm_type} />
                      </td>
                      {isVisible('title') && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span className="text-gray-800 font-medium truncate">
                              <HighlightText text={item.title || '无标题'} keyword={search} />
                            </span>
                            {item.extraction_rule_id && rulesMap[item.extraction_rule_id] && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-violet-50 text-violet-700 border border-violet-200 font-medium">
                                {rulesMap[item.extraction_rule_id]}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {isVisible('tags') && (
                        <td className="py-3 px-4 max-w-[200px]" onClick={(e) => e.stopPropagation()}>
                          <InlineTagEditor
                            contentType="communication"
                            contentId={item.id}
                            tags={tagsMap[item.id] || []}
                            onChanged={() => { reloadTags(); setTagRefreshKey(k => k + 1) }}
                          />
                        </td>
                      )}
                      {isVisible('comm_time') && (
                        <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                          {item.comm_time ? new Date(item.comm_time).toLocaleString('zh-CN') : '-'}
                        </td>
                      )}
                      {isVisible('initiator') && (
                        <td className={`py-3 px-4 text-gray-500 ${search && item.matched_fields?.includes('initiator') ? 'bg-amber-50' : ''}`}>
                          <HighlightText text={item.initiator || '-'} keyword={search} />
                        </td>
                      )}
                      {isVisible('participants') && (
                        <td className="py-3 px-4 text-gray-500">
                          {(item.participants || []).length > 0
                            ? (item.participants || []).slice(0, 3).map(p => p.name || '未知').join('、') + ((item.participants || []).length > 3 ? ` 等${item.participants.length}人` : '')
                            : '-'}
                        </td>
                      )}
                      {isVisible('chat_name') && (
                        <td className={`py-3 px-4 text-gray-500 ${search && item.matched_fields?.includes('chat_name') ? 'bg-amber-50' : ''}`}>
                          <HighlightText text={item.chat_name || '个人聊天'} keyword={search} />
                        </td>
                      )}
                      {isVisible('key_info') && (
                        <td className="py-3 px-4 max-w-[280px] bg-violet-50/30">
                          {item.key_info && Object.keys(item.key_info).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(item.key_info).slice(0, 3).map(([k, v]) => (
                                <span key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-violet-100 text-violet-800 border border-violet-200" title={`${k}: ${v}`}>
                                  <span className="text-violet-500 mr-0.5">{k}:</span>
                                  <span className="truncate max-w-[90px]">{String(v)}</span>
                                </span>
                              ))}
                              {Object.keys(item.key_info).length > 3 && (
                                <span className="text-xs text-violet-400">+{Object.keys(item.key_info).length - 3}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                      )}
                      {isVisible('content') && (
                        <td className={`py-3 px-4 text-gray-500 max-w-xs truncate ${search && (item.matched_fields?.includes('summary') || item.matched_fields?.includes('content_text')) ? 'bg-amber-50' : ''}`}>
                          <HighlightText text={item.summary?.slice(0, 60) || item.content_text?.slice(0, 60) || '-'} keyword={search} />
                        </td>
                      )}
                      {isVisible('attachments') && (
                        <td className="py-3 px-4">
                          <AttachmentBadges extraFields={item.extra_fields} />
                        </td>
                      )}
                      {isVisible('source_url') && (
                        <td className="py-3 px-4">
                          {item.source_url ? (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:text-indigo-800 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                              title="查看会议纪要"
                            >
                              <FileText size={16} />
                            </a>
                          ) : '-'}
                        </td>
                      )}
                      {isVisible('duration') && (
                        <td className="py-3 px-4 text-gray-500">
                          {item.duration_minutes ? `${item.duration_minutes} 分钟` : '-'}
                        </td>
                      )}
                      {isVisible('location') && (
                        <td className={`py-3 px-4 text-gray-500 truncate max-w-[200px] ${search && item.matched_fields?.includes('location') ? 'bg-amber-50' : ''}`}>
                          <HighlightText text={item.location || '-'} keyword={search} />
                        </td>
                      )}
                      {isVisible('keywords') && (
                        <td className="py-3 px-4 max-w-[200px]">
                          <div className="flex flex-wrap gap-1">
                            {(item.keywords || []).slice(0, 3).map((kw, i) => (
                              <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"><HighlightText text={kw} keyword={search} /></span>
                            ))}
                          </div>
                        </td>
                      )}
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {item.source_url && (
                            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="跳转源文档">
                              <ExternalLink size={14} />
                            </a>
                          )}
                          {item.bitable_url && (
                            <a href={item.bitable_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="跳转源多维表格">
                              <Table2 size={14} />
                            </a>
                          )}
                          <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="删除">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={99} className="py-12 text-center text-gray-400">
                        <p>暂无沟通记录</p>
                        <button
                          type="button"
                          onClick={() => navigate('/data-import')}
                          className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                        >
                          前往数据归档
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">共 {data?.total ?? 0} 条，第 {page}/{totalPages} 页</span>
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
        )}
      </div>

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

          {/* 自定义提取内容 */}
          {item.key_info && Object.keys(item.key_info).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">自定义提取内容</p>
              <div className="space-y-2">
                {Object.entries(item.key_info).map(([k, v]) => (
                  <div key={k} className="bg-violet-50 rounded-lg p-3">
                    <p className="text-xs text-violet-500 font-medium mb-0.5">{k}</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{String(v)}</p>
                  </div>
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

          {/* 相关链接 */}
          {(item.source_url || item.recording_url || item.bitable_url) && (
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
                {item.bitable_url && (
                  <a
                    href={item.bitable_url}
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
          {isMeetingLike && (item.participants || []).length > 0 && (
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
          {isChat && (item.participants || []).length > 0 && (
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
          {isMeetingLike && (item.action_items || []).length > 0 && (
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

// ─── 表格内附件缩略展示 ─────────────────────────────────────
function AttachmentBadges({ extraFields }: { extraFields?: CommunicationItem['extra_fields'] }) {
  const attachments = extraFields?._attachments || []
  if (attachments.length === 0) return <span className="text-gray-400">-</span>

  const images = attachments.filter(a => isImage(a.name, a.type))
  const files = attachments.filter(a => !isImage(a.name, a.type))

  return (
    <div className="flex items-center gap-1.5">
      {images.length > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
          <Image size={12} />
          {images.length}
        </span>
      )}
      {files.length > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
          <Paperclip size={12} />
          {files.length}
        </span>
      )}
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
