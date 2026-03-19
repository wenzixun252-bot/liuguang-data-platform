import { useEffect, useState, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, X, Clock, MapPin, Users, Paperclip, ExternalLink, Download, Image, FileText, Trash2, MessageSquare, Video, Mic, Table2, Upload } from 'lucide-react'
import api, { getExtractionRules } from '../lib/api'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { getUser } from '../lib/auth'
import { TagChips, BatchTagBar, useContentTags, InlineTagEditor, TagFilter } from '../components/TagManager'
import { ColumnFilter } from '../components/ColumnFilter'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { HighlightText } from '../components/HighlightText'
import ExtractionRuleSlicer from '../components/ExtractionRuleSlicer'
import ExtractionFieldView from '../components/ExtractionFieldView'
import { DataTable, type DataTableColumn, getPersistedDisplayCount } from '../components/DataTable'

// ─── 类型切换选项 ───────────────────────────────────────────
type CommTypeFilter = 'meeting' | 'chat'

const COMM_TYPE_OPTIONS: { value: CommTypeFilter; label: string }[] = [
  { value: 'meeting', label: '会议（含录音）' },
  { value: 'chat', label: '会话' },
]

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
  asset_owner_name: string | null
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
  const [search, setSearch] = useState('')
  const [commTypeFilter, setCommTypeFilter] = useState<CommTypeFilter>('meeting')
  const [displayCount, setDisplayCount] = useState(() => getPersistedDisplayCount(`comm-${commTypeFilter}`))
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({})
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({})
  const [tagIds, setTagIds] = useState<number[]>([])
  const [selected, setSelected] = useState<CommunicationItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [tagRefreshKey, setTagRefreshKey] = useState(0)
  const [extractionRuleId, setExtractionRuleId] = useState<number | null>(null)
  const [fieldViewRuleId, setFieldViewRuleId] = useState<number | null>(null)

  // 提取规则名称映射
  const { data: rulesList } = useQuery({ queryKey: ['extraction-rules'], queryFn: getExtractionRules })
  const rulesMap: Record<number, string> = {}
  if (Array.isArray(rulesList)) {
    rulesList.forEach((r: any) => { rulesMap[r.id] = r.name })
  }

  // 后端支持的筛选参数
  const backendFilterKeys = ['initiator']

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

  const updateColumnFilter = (key: string, vals: string[]) => {
    setColumnFilters((prev) => {
      const next = { ...prev }
      if (vals.length === 0) delete next[key]
      else next[key] = vals
      return next
    })
  }
  const updateDateFilter = (field: string, from: string, to: string) => {
    setDateFilters((prev) => {
      const next = { ...prev }
      if (!from && !to) delete next[field]
      else next[field] = { from, to }
      return next
    })
  }

  // 前端本地过滤（对后端不支持的筛选字段）
  const filteredItems = useMemo(() => {
    if (!data?.items) return []
    let items = data.items
    for (const [key, vals] of Object.entries(columnFilters)) {
      if (vals.length === 0 || backendFilterKeys.includes(key)) continue
      items = items.filter((item) => {
        if (key === 'participants') return (item.participants || []).some((p) => vals.includes(p.name || ''))
        if (key === 'chat_name') return vals.includes(item.chat_name || '个人聊天')
        if (key === 'location') return vals.includes(item.location || '')
        if (key === 'uploader_name') return vals.includes(item.uploader_name || '')
        return true
      })
    }
    return items
  }, [data?.items, columnFilters])

  const currentIds = filteredItems.map((i) => i.id)
  const { tagsMap, reloadTags } = useContentTags('communication', currentIds, tagRefreshKey)

  // ─── 共享列渲染器 ─────────────────────────────────────
  const keyInfoCell = (item: CommunicationItem) => {
    if (!item.key_info || Object.keys(item.key_info).length === 0) return <span className="text-gray-300 text-xs">-</span>
    return (
      <div className="flex flex-wrap gap-1">
        {Object.entries(item.key_info).slice(0, 3).map(([k, v]) => (
          <span key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-violet-100 text-violet-800 border border-violet-200" title={`${k}: ${v == null || v === 'null' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`}>
            <span className="text-violet-500 mr-0.5">{k}:</span>
            <span className="truncate max-w-[90px]"><HighlightText text={v == null || v === 'null' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)} keyword={search} /></span>
          </span>
        ))}
        {Object.keys(item.key_info).length > 3 && <span className="text-xs text-violet-400">+{Object.keys(item.key_info).length - 3}</span>}
      </div>
    )
  }

  const actionsCell = (item: CommunicationItem) => (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      {item.source_url && (
        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="跳转源文档">
          <ExternalLink size={14} />
        </a>
      )}
      {item.bitable_url && (
        <a href={item.bitable_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-purple-50 rounded-lg text-purple-600" title="跳转源多维表格">
          <Table2 size={14} />
        </a>
      )}
      <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="删除">
        <Trash2 size={14} />
      </button>
    </div>
  )

  // ─── 会议列定义 ─────────────────────────────────────────
  const meetingColumns = useMemo<DataTableColumn<CommunicationItem>[]>(() => [
    {
      key: 'title',
      label: '主题',
      width: 240,
      minWidth: 140,
      frozen: true,
      sortable: true,
      cell: (item) => (
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
      ),
    },
    {
      key: 'tags',
      label: '标签',
      width: 180,
      minWidth: 100,
      cell: (item) => (
        <InlineTagEditor
          contentType="communication"
          contentId={item.id}
          tags={tagsMap[item.id] || []}
          onChanged={() => { reloadTags(); setTagRefreshKey(k => k + 1) }}
        />
      ),
    },
    {
      key: 'uploader_name',
      label: '上传人',
      width: 110,
      headerExtra: <ColumnFilter options={uniqueValues('uploader_name')} selected={columnFilters.uploader_name || []} onChange={(v) => updateColumnFilter('uploader_name', v)} />,
      cell: (item) => <span className="text-gray-600">{item.uploader_name || '-'}</span>,
    },
    {
      key: 'key_info',
      label: '自定义提取内容',
      width: 300,
      headerClassName: 'text-violet-700 font-semibold bg-violet-50/50',
      cellClassName: (item) => search && item.matched_fields?.includes('key_info') ? 'bg-amber-50' : 'bg-violet-50/30',
      cell: keyInfoCell,
    },
    {
      key: 'comm_time',
      label: '会议时间',
      width: 160,
      sortable: true,
      headerExtra: <DateRangeFilter from={dateFilters.comm_time?.from || ''} to={dateFilters.comm_time?.to || ''} onChange={(f, t) => updateDateFilter('comm_time', f, t)} />,
      cell: (item) => <span className="text-gray-500 whitespace-nowrap">{item.comm_time ? new Date(item.comm_time).toLocaleString('zh-CN') : '-'}</span>,
    },
    {
      key: 'initiator',
      label: '组织者',
      width: 110,
      headerExtra: <ColumnFilter options={uniqueValues('initiator')} selected={columnFilters.initiator || []} onChange={(v) => updateColumnFilter('initiator', v)} />,
      cellClassName: (item) => search && item.matched_fields?.includes('initiator') ? 'bg-amber-50' : '',
      cell: (item) => <HighlightText text={item.initiator || '-'} keyword={search} />,
    },
    {
      key: 'participants',
      label: '参与人',
      width: 180,
      headerExtra: <ColumnFilter options={uniqueValues('participants')} selected={columnFilters.participants || []} onChange={(v) => updateColumnFilter('participants', v)} />,
      cell: (item) => {
        const ps = item.participants || []
        return <span className="text-gray-500">{ps.length > 0 ? ps.slice(0, 3).map(p => p.name || '未知').join('、') + (ps.length > 3 ? ` 等${ps.length}人` : '') : '-'}</span>
      },
    },
    {
      key: 'content',
      label: '内容预览',
      width: 260,
      cellClassName: (item) => search && (item.matched_fields?.includes('summary') || item.matched_fields?.includes('content_text')) ? 'bg-amber-50' : '',
      cell: (item) => <span className="text-gray-500"><HighlightText text={item.summary?.slice(0, 60) || item.content_text?.slice(0, 60) || '-'} keyword={search} /></span>,
    },
    {
      key: 'source_url',
      label: '会议纪要',
      width: 80,
      cell: (item) => item.source_url ? (
        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800" onClick={e => e.stopPropagation()} title="查看会议纪要">
          <FileText size={16} />
        </a>
      ) : <span className="text-gray-300">-</span>,
    },
    {
      key: 'synced_at',
      label: '上传/同步时间',
      width: 160,
      sortable: true,
      headerExtra: <DateRangeFilter from={dateFilters.synced_at?.from || ''} to={dateFilters.synced_at?.to || ''} onChange={(f, t) => updateDateFilter('synced_at', f, t)} />,
      cell: (item) => <span className="text-gray-500 whitespace-nowrap">{item.synced_at ? new Date(item.synced_at).toLocaleString('zh-CN') : (item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-')}</span>,
    },
    {
      key: 'duration',
      label: '时长',
      width: 90,
      cell: (item) => <span className="text-gray-500">{item.duration_minutes ? `${item.duration_minutes} 分钟` : '-'}</span>,
    },
    {
      key: 'location',
      label: '地点',
      width: 150,
      headerExtra: <ColumnFilter options={uniqueValues('location')} selected={columnFilters.location || []} onChange={(v) => updateColumnFilter('location', v)} />,
      cellClassName: (item) => search && item.matched_fields?.includes('location') ? 'bg-amber-50' : '',
      cell: (item) => <span className="text-gray-500"><HighlightText text={item.location || '-'} keyword={search} /></span>,
    },
    {
      key: 'keywords',
      label: '关键词',
      width: 200,
      cell: (item) => (
        <div className="flex flex-wrap gap-1">
          {(item.keywords || []).slice(0, 3).map((kw, i) => (
            <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"><HighlightText text={kw} keyword={search} /></span>
          ))}
        </div>
      ),
    },
    { key: 'actions', label: '操作', width: 100, minWidth: 80, cell: actionsCell },
  ], [search, tagsMap, rulesMap, columnFilters, dateFilters, reloadTags])

  // ─── 会话列定义 ─────────────────────────────────────────
  const chatColumns = useMemo<DataTableColumn<CommunicationItem>[]>(() => [
    {
      key: 'tags',
      label: '标签',
      width: 180,
      minWidth: 100,
      cell: (item) => (
        <InlineTagEditor
          contentType="communication"
          contentId={item.id}
          tags={tagsMap[item.id] || []}
          onChanged={() => { reloadTags(); setTagRefreshKey(k => k + 1) }}
        />
      ),
    },
    {
      key: 'comm_time',
      label: '发送时间',
      width: 160,
      sortable: true,
      headerExtra: <DateRangeFilter from={dateFilters.comm_time?.from || ''} to={dateFilters.comm_time?.to || ''} onChange={(f, t) => updateDateFilter('comm_time', f, t)} />,
      cell: (item) => <span className="text-gray-500 whitespace-nowrap">{item.comm_time ? new Date(item.comm_time).toLocaleString('zh-CN') : '-'}</span>,
    },
    {
      key: 'initiator',
      label: '发送者',
      width: 110,
      headerExtra: <ColumnFilter options={uniqueValues('initiator')} selected={columnFilters.initiator || []} onChange={(v) => updateColumnFilter('initiator', v)} />,
      cellClassName: (item) => search && item.matched_fields?.includes('initiator') ? 'bg-amber-50' : '',
      cell: (item) => <HighlightText text={item.initiator || '-'} keyword={search} />,
    },
    {
      key: 'uploader_name',
      label: '上传人',
      width: 110,
      headerExtra: <ColumnFilter options={uniqueValues('uploader_name')} selected={columnFilters.uploader_name || []} onChange={(v) => updateColumnFilter('uploader_name', v)} />,
      cell: (item) => <span className="text-gray-600">{item.uploader_name || '-'}</span>,
    },
    {
      key: 'chat_name',
      label: '群组名称',
      width: 150,
      headerExtra: <ColumnFilter options={uniqueValues('chat_name')} selected={columnFilters.chat_name || []} onChange={(v) => updateColumnFilter('chat_name', v)} />,
      cellClassName: (item) => search && item.matched_fields?.includes('chat_name') ? 'bg-amber-50' : '',
      cell: (item) => <HighlightText text={item.chat_name || '个人聊天'} keyword={search} />,
    },
    {
      key: 'content',
      label: '发送内容',
      width: 260,
      cellClassName: (item) => search && (item.matched_fields?.includes('summary') || item.matched_fields?.includes('content_text')) ? 'bg-amber-50' : '',
      cell: (item) => <span className="text-gray-500"><HighlightText text={item.summary?.slice(0, 60) || item.content_text?.slice(0, 60) || '-'} keyword={search} /></span>,
    },
    {
      key: 'attachments',
      label: '附件',
      width: 100,
      cell: (item) => <AttachmentBadges extraFields={item.extra_fields} />,
    },
    {
      key: 'keywords',
      label: '关键词',
      width: 200,
      cell: (item) => (
        <div className="flex flex-wrap gap-1">
          {(item.keywords || []).slice(0, 3).map((kw, i) => (
            <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"><HighlightText text={kw} keyword={search} /></span>
          ))}
        </div>
      ),
    },
    { key: 'actions', label: '操作', width: 100, minWidth: 80, cell: actionsCell },
  ], [search, tagsMap, rulesMap, columnFilters, dateFilters, reloadTags])

  const activeColumns = commTypeFilter === 'meeting' ? meetingColumns : chatColumns

  // 加载数据
  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page: 1, page_size: displayCount }
    if (search) params.search = search
    params.comm_type = commTypeFilter
    if (tagIds.length > 0) params.tag_ids = tagIds
    if (extractionRuleId) params.extraction_rule_id = extractionRuleId
    for (const [key, vals] of Object.entries(columnFilters)) {
      if (vals.length > 0 && backendFilterKeys.includes(key)) params[key] = vals.join(',')
    }
    if (dateFilters.comm_time?.from) params.start_date = dateFilters.comm_time.from + 'T00:00:00'
    if (dateFilters.comm_time?.to) params.end_date = dateFilters.comm_time.to + 'T23:59:59'

    api.get('/communications/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载沟通记录失败'))
      .finally(() => setLoading(false))
  }, [displayCount, search, commTypeFilter, columnFilters, dateFilters, tagIds, extractionRuleId, refreshKey])

  // 切换筛选条件时清空选择
  useEffect(() => {
    setSelectedIds(new Set())
  }, [search, commTypeFilter, columnFilters, dateFilters, tagIds, extractionRuleId])

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
  }

  return (
    <div className="space-y-4">
      {/* 页面标题和工具栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">沟通数据</h1>
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
              placeholder="搜索主题、内容、摘要、组织者、自定义提取..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
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
      <TagFilter selectedTagIds={tagIds} onChange={setTagIds} />

      {/* 提取规则切片器 */}
      <ExtractionRuleSlicer
        selectedRuleId={extractionRuleId}
        onSelect={setExtractionRuleId}
        onViewFields={(id) => setFieldViewRuleId(id)}
      />

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg flex-wrap">
          <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 项</span>
          <BatchTagBar selectedIds={selectedIds} contentType="communication" onDone={() => setRefreshKey((k) => k + 1)} />
          <button onClick={handleBatchDelete} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm">
            <Trash2 size={14} />
            批量删除
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">
            取消选择
          </button>
        </div>
      )}

      {/* DataTable */}
      <DataTable<CommunicationItem>
        key={`comm-${commTypeFilter}`}
        columns={activeColumns}
        data={filteredItems}
        rowKey={(item) => item.id}
        loading={loading}
        storageKey={`comm-${commTypeFilter}`}
        search={search}
        reorderable
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onRowClick={(item) => setSelected(item)}
        activeRowId={selected?.id}
        total={data?.total ?? 0}
        displayCount={displayCount}
        onDisplayCountChange={setDisplayCount}
        emptyContent={
          <div>
            <p>暂无沟通记录</p>
            <button type="button" onClick={() => navigate('/data-import')} className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium">
              前往数据归档
            </button>
          </div>
        }
      />

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

      {/* 提取规则字段汇总视图 */}
      {fieldViewRuleId && <ExtractionFieldView ruleId={fieldViewRuleId} onClose={() => setFieldViewRuleId(null)} />}
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
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-800">{isMeetingLike ? '会议详情' : '消息详情'}</h2>
              <CommTypeBadge type={item.comm_type} />
            </div>
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
          <h3 className="text-lg font-semibold text-gray-800">{item.title || '无标题'}</h3>
          <div>
            <p className="text-sm text-gray-500 mb-1">标签</p>
            <TagChips contentType="communication" contentId={item.id} editable />
          </div>
          {item.keywords && item.keywords.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">关键词</p>
              <div className="flex flex-wrap gap-1.5">
                {item.keywords.map((kw, i) => <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">{kw}</span>)}
              </div>
            </div>
          )}
          {isMeetingLike && item.key_info && Object.keys(item.key_info).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">自定义提取内容</p>
              <div className="space-y-2">
                {Object.entries(item.key_info).map(([k, v]) => (
                  <div key={k} className="bg-violet-50 rounded-lg p-3">
                    <p className="text-xs text-violet-500 font-medium mb-0.5">{k}</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{v == null || v === 'null' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isMeetingLike && (
            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
              {item.comm_time && <span className="flex items-center gap-1"><Clock size={14} />{new Date(item.comm_time).toLocaleString('zh-CN')}{item.duration_minutes && ` (${item.duration_minutes}分钟)`}</span>}
              {item.location && <span className="flex items-center gap-1"><MapPin size={14} />{item.location}</span>}
            </div>
          )}
          {isChat && (
            <>
              {item.initiator && <Field label="发送者" value={item.initiator} />}
              <Field label="群组名称" value={item.chat_name || '个人聊天'} />
              {item.comm_time && <Field label="发送时间" value={new Date(item.comm_time).toLocaleString('zh-CN')} />}
              {item.reply_to && <Field label="回复" value={item.reply_to} />}
            </>
          )}
          {isMeetingLike && item.initiator && <Field label="组织者" value={item.initiator} />}
          {(item.source_url || item.recording_url || item.bitable_url) && (
            <div>
              <p className="text-sm text-gray-500 mb-1">相关链接</p>
              <div className="flex flex-wrap gap-2">
                {item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors"><FileText size={14} />查看完整纪要</a>}
                {item.recording_url && <a href={item.recording_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 bg-orange-50 text-orange-700 rounded-lg text-sm hover:bg-orange-100 transition-colors"><Mic size={14} />查看录音</a>}
                {item.bitable_url && <a href={item.bitable_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100 transition-colors"><ExternalLink size={14} />查看源多维表格</a>}
              </div>
            </div>
          )}
          {isMeetingLike && (item.participants || []).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1 flex items-center gap-1"><Users size={14} /> 参与人</p>
              <div className="flex flex-wrap gap-2">
                {item.participants.map((p, i) => <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">{p.name || p.open_id || '未知'}</span>)}
              </div>
            </div>
          )}
          {isChat && (item.participants || []).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">提及</p>
              <div className="flex flex-wrap gap-2">
                {item.participants.map((m, i) => <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">@{m.name || m.open_id || '未知'}</span>)}
              </div>
            </div>
          )}
          {isMeetingLike && item.agenda && (
            <div>
              <p className="text-sm text-gray-500 mb-1">议程</p>
              <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{item.agenda}</p>
            </div>
          )}
          {isMeetingLike && item.conclusions && (
            <div>
              <p className="text-sm text-gray-500 mb-1">结论</p>
              <p className="text-sm text-gray-800 bg-green-50 rounded-lg p-3 whitespace-pre-wrap">{item.conclusions}</p>
            </div>
          )}
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
          {isMeetingLike && item.transcript && (
            <div>
              <p className="text-sm text-gray-500 mb-1">会议转录</p>
              <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-60 overflow-y-auto">{item.transcript}</div>
            </div>
          )}
          {item.summary && (
            <div>
              <p className="text-sm text-gray-500 mb-1">摘要</p>
              <p className="text-sm text-gray-800 bg-indigo-50 rounded-lg p-3 whitespace-pre-wrap">{item.summary}</p>
            </div>
          )}
          <div>
            <p className="text-sm text-gray-500 mb-1">全文内容</p>
            <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">{item.content_text}</div>
          </div>
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

function AttachmentBadges({ extraFields }: { extraFields?: CommunicationItem['extra_fields'] }) {
  const attachments = extraFields?._attachments || []
  if (attachments.length === 0) return <span className="text-gray-400">-</span>
  const images = attachments.filter(a => isImage(a.name, a.type))
  const files = attachments.filter(a => !isImage(a.name, a.type))
  return (
    <div className="flex items-center gap-1.5">
      {images.length > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs"><Image size={12} />{images.length}</span>}
      {files.length > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"><Paperclip size={12} />{files.length}</span>}
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
                  <img src={`/api/upload/attachments/${att.file_token}`} alt={att.name} className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                    <Image size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">{att.name}</p>
                </div>
              ) : (
                <a key={att.file_token} href={`/api/upload/attachments/${att.file_token}`} download className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
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
              <a key={i} href={lnk.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:underline">
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
