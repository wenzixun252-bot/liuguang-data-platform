import { useEffect, useState, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, X, Paperclip, ExternalLink, Download, Image, User, Trash2, Upload } from 'lucide-react'
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
import ArchiverPopover from '../components/ArchiverPopover'
import { DataTable, type DataTableColumn, getPersistedDisplayCount } from '../components/DataTable'

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
  original_filename: string | null
  source_type: string
  source_platform: string | null
  source_app_token: string | null
  source_table_id: string | null
  content_text: string
  summary: string | null
  author: string | null
  file_type: string | null
  keywords: string[]
  key_info?: Record<string, string> | null
  tags: Record<string, unknown>
  source_url: string | null
  asset_owner_name: string | null
  uploader_name: string | null
  extra_fields?: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  feishu_record_id: string | null
  bitable_url: string | null
  extraction_rule_id?: number | null
  matched_fields: string[]
  parse_status: string | null
  import_count: number
  synced_at: string | null
  feishu_created_at: string | null
  feishu_updated_at: string | null
  created_at: string
  updated_at: string
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

const PLATFORM_LABELS: Record<string, string> = {
  feishu_cloud_doc: '飞书云文档',
  feishu_folder: '飞书文件夹',
  feishu: '飞书同步',
}

function getSourceLabel(item: { source_type: string; source_platform: string | null }) {
  if (item.source_type === 'cloud' && item.source_platform && PLATFORM_LABELS[item.source_platform]) {
    return PLATFORM_LABELS[item.source_platform]
  }
  return SOURCE_LABELS[item.source_type] || item.source_type
}

export default function Documents() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<DocumentListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [displayCount, setDisplayCount] = useState(() => getPersistedDisplayCount('documents'))
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({})
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({})
  const [tagIds, setTagIds] = useState<number[]>([])
  const [selected, setSelected] = useState<DocumentItem | null>(null)
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

  const currentIds = data?.items.map((i) => i.id) || []
  const { tagsMap, reloadTags } = useContentTags('document', currentIds, tagRefreshKey)
  const sourceTypeOptions = ['cloud', 'local']

  const uniqueValues = (key: string) => {
    if (!data?.items) return []
    const vals = new Set<string>()
    for (const item of data.items) {
      const v = (item as unknown as Record<string, unknown>)[key]
      if (v != null && v !== '') vals.add(String(v))
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

  // 列定义 - 将原来的 <td> 渲染逻辑迁移到 cell 函数中
  const fileTypeLabel = (ft: string | null | undefined) => {
    if (!ft) return '-'
    const map: Record<string, string> = {
      docx: '文档', doc: '文档', pdf: 'PDF', xlsx: '表格', xls: '表格',
      pptx: '幻灯片', ppt: '幻灯片', txt: '文本', md: '文本',
      png: '图片', jpg: '图片', jpeg: '图片', gif: '图片', svg: '图片', webp: '图片',
      csv: '表格', json: '数据', html: '网页', zip: '压缩包', rar: '压缩包',
    }
    return map[ft.toLowerCase()] || ft.toUpperCase()
  }

  const tableColumns = useMemo<DataTableColumn<DocumentItem>[]>(() => [
    {
      key: 'title',
      label: '标题',
      width: 260,
      minWidth: 160,
      frozen: true,
      sortable: true,
      cell: (item) => (
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="text-gray-800 font-medium truncate">
            <HighlightText text={item.title || item.original_filename || '无标题'} keyword={search} />
          </span>
          {item.parse_status === 'pending' && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-600 border border-amber-200">分析中</span>
          )}
          {item.parse_status === 'failed' && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-red-50 text-red-500 border border-red-200">解析失败</span>
          )}
          {(item.import_count ?? 1) > 1 && (
            <ArchiverPopover contentType="document" contentId={item.id} importCount={item.import_count} />
          )}
          {item.extraction_rule_id && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-violet-50 text-violet-700 border border-violet-200 font-medium">
              {rulesMap[item.extraction_rule_id] || '提取规则'}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'file_type',
      label: '类型',
      width: 90,
      headerExtra: (
        <ColumnFilter options={uniqueValues('file_type')} selected={columnFilters.file_type || []} onChange={(v) => updateColumnFilter('file_type', v)} />
      ),
      cell: (item) => <span className="text-gray-500">{fileTypeLabel(item.file_type)}</span>,
    },
    {
      key: 'tags',
      label: '标签',
      width: 180,
      minWidth: 100,
      cell: (item) => (
        <InlineTagEditor
          contentType="document"
          contentId={item.id}
          tags={tagsMap[item.id] || []}
          onChanged={() => { reloadTags(); setTagRefreshKey(k => k + 1) }}
        />
      ),
    },
    {
      key: 'summary',
      label: '摘要',
      width: 260,
      cellClassName: (item) => search && item.matched_fields?.includes('summary') ? 'bg-amber-50' : '',
      cell: (item) => (
        <span className="text-gray-500">
          <HighlightText text={item.summary || item.content_text?.slice(0, 60) || '-'} keyword={search} />
        </span>
      ),
    },
    {
      key: 'key_info',
      label: '自定义提取内容',
      width: 300,
      headerClassName: 'text-violet-700 font-semibold bg-violet-50/50',
      cellClassName: (item) => search && item.matched_fields?.includes('key_info') ? 'bg-amber-50' : 'bg-violet-50/30',
      cell: (item) => {
        if (!item.key_info || Object.keys(item.key_info).length === 0) {
          return <span className="text-gray-300 text-xs">-</span>
        }
        return (
          <div className="flex flex-wrap gap-1">
            {Object.entries(item.key_info).slice(0, 3).map(([k, v]) => (
              <span key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-violet-100 text-violet-800 border border-violet-200" title={`${k}: ${v == null || v === 'null' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`}>
                <span className="text-violet-500 mr-0.5">{k}:</span>
                <span className="truncate max-w-[90px]"><HighlightText text={v == null || v === 'null' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)} keyword={search} /></span>
              </span>
            ))}
            {Object.keys(item.key_info).length > 3 && (
              <span className="text-xs text-violet-400">+{Object.keys(item.key_info).length - 3}</span>
            )}
          </div>
        )
      },
    },
    {
      key: 'source_type',
      label: '来源',
      width: 120,
      headerExtra: (
        <ColumnFilter options={sourceTypeOptions} selected={columnFilters.source_type || []} onChange={(v) => updateColumnFilter('source_type', v)} />
      ),
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs ${item.source_type === 'cloud' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
          {getSourceLabel(item)}
        </span>
      ),
    },
    {
      key: 'feishu_created_at',
      label: '创建时间',
      width: 110,
      sortable: true,
      headerExtra: (
        <DateRangeFilter from={dateFilters.feishu_created_at?.from || ''} to={dateFilters.feishu_created_at?.to || ''} onChange={(f, t) => updateDateFilter('feishu_created_at', f, t)} />
      ),
      cell: (item) => (
        <span className="text-gray-500 whitespace-nowrap">
          {item.feishu_created_at ? new Date(item.feishu_created_at).toLocaleDateString('zh-CN') : '-'}
        </span>
      ),
    },
    {
      key: 'feishu_updated_at',
      label: '修改时间',
      width: 110,
      sortable: true,
      headerExtra: (
        <DateRangeFilter from={dateFilters.feishu_updated_at?.from || ''} to={dateFilters.feishu_updated_at?.to || ''} onChange={(f, t) => updateDateFilter('feishu_updated_at', f, t)} />
      ),
      cell: (item) => (
        <span className="text-gray-500 whitespace-nowrap">
          {item.feishu_updated_at ? new Date(item.feishu_updated_at).toLocaleDateString('zh-CN') : '-'}
        </span>
      ),
    },
    {
      key: 'synced_at',
      label: '上传时间',
      width: 150,
      sortable: true,
      headerExtra: (
        <DateRangeFilter from={dateFilters.synced_at?.from || ''} to={dateFilters.synced_at?.to || ''} onChange={(f, t) => updateDateFilter('synced_at', f, t)} />
      ),
      cell: (item) => (
        <span className="text-gray-500 whitespace-nowrap">{new Date(item.synced_at || item.created_at).toLocaleString('zh-CN')}</span>
      ),
    },
    {
      key: 'asset_owner_name',
      label: '数据所有人',
      width: 130,
      headerClassName: 'text-indigo-700 font-semibold bg-indigo-50/50',
      cellClassName: (item) => search && item.matched_fields?.includes('asset_owner_name') ? 'bg-amber-50' : 'bg-indigo-50/30',
      headerExtra: (
        <ColumnFilter options={uniqueValues('asset_owner_name')} selected={columnFilters.asset_owner_name || []} onChange={(v) => updateColumnFilter('asset_owner_name', v)} />
      ),
      cell: (item) => (
        <span className="text-indigo-700 font-medium">
          <HighlightText text={item.asset_owner_name || '-'} keyword={search} />
        </span>
      ),
    },
    {
      key: 'uploader_name',
      label: '上传人',
      width: 120,
      headerExtra: (
        <ColumnFilter options={uniqueValues('uploader_name')} selected={columnFilters.uploader_name || []} onChange={(v) => updateColumnFilter('uploader_name', v)} />
      ),
      cell: (item) => (
        <span className="text-gray-700 font-medium">
          <HighlightText text={item.uploader_name || '-'} keyword={search} />
        </span>
      ),
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
          {(item.keywords || []).length > 3 && (
            <span className="px-1.5 py-0.5 text-gray-400 text-xs">+{(item.keywords || []).length - 3}</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      width: 100,
      minWidth: 70,
      cell: (item) => (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {item.source_type === 'local' && (
            <button onClick={() => handleDownload(item.id, item.title)} className="p-1.5 hover:bg-green-50 rounded-lg text-green-600" title="下载文件">
              <Download size={14} />
            </button>
          )}
          {item.source_url && (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="跳转源文档">
              <ExternalLink size={14} />
            </a>
          )}
          <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="删除">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ], [search, tagsMap, rulesMap, columnFilters, dateFilters, reloadTags])

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page: 1, page_size: displayCount }
    if (search) params.search = search
    if (tagIds.length > 0) params.tag_ids = tagIds
    if (extractionRuleId) params.extraction_rule_id = extractionRuleId
    for (const [key, vals] of Object.entries(columnFilters)) {
      if (vals.length > 0) params[key] = vals.join(',')
    }

    // 时间筛选 - pick the first active date filter
    for (const [field, range] of Object.entries(dateFilters)) {
      if (range.from || range.to) {
        params.date_field = field
        if (range.from) params.date_from = range.from + 'T00:00:00'
        if (range.to) params.date_to = range.to + 'T23:59:59'
        break
      }
    }

    api.get('/documents/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载文档列表失败'))
      .finally(() => setLoading(false))
  }, [displayCount, search, columnFilters, dateFilters, tagIds, extractionRuleId, refreshKey])

  // 筛选变化时清空选择
  useEffect(() => {
    setSelectedIds(new Set())
  }, [search, columnFilters, dateFilters, tagIds, extractionRuleId])

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
      const res = await api.post('/documents/batch-delete', { ids: Array.from(selectedIds) })
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
      await api.delete(`/documents/${id}`)
      toast.success('已删除')
      if (selected?.id === id) setSelected(null)
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error('删除失败')
    }
  }

  const handleDownload = async (id: number, title: string | null) => {
    try {
      const resp = await api.get(`/documents/${id}/download`, { responseType: 'blob' })
      const disposition = resp.headers['content-disposition'] || ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match ? match[1] : title || 'download'
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('下载失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">文档数据</h1>
          <button
            type="button"
            onClick={() => navigate('/data-import')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Upload size={14} />
            导入数据
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索标题、内容、摘要、关键词、自定义提取..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* 标签切片器 */}
      <TagFilter
        selectedTagIds={tagIds}
        onChange={setTagIds}
      />

      {/* 提取规则切片器 */}
      <ExtractionRuleSlicer
        selectedRuleId={extractionRuleId}
        onSelect={setExtractionRuleId}
        onViewFields={(id) => setFieldViewRuleId(id)}
      />

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg flex-wrap">
          <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 项</span>
          <BatchTagBar
            selectedIds={selectedIds}
            contentType="document"
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

      {/* DataTable */}
      <DataTable<DocumentItem>
        columns={tableColumns}
        data={data?.items || []}
        rowKey={(item) => item.id}
        loading={loading}
        storageKey="documents"
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
            <p>暂无文档数据</p>
            <button
              type="button"
              onClick={() => navigate('/data-import')}
              className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
            >
              前往数据归档
            </button>
          </div>
        }
      />

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

      {/* 提取规则字段汇总视图 */}
      {fieldViewRuleId && (
        <ExtractionFieldView
          ruleId={fieldViewRuleId}
          onClose={() => setFieldViewRuleId(null)}
        />
      )}
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
          {doc.original_filename && <Field label="原始文件名" value={doc.original_filename} />}
          <Field label="来源" value={getSourceLabel(doc)} />
          {doc.asset_owner_name && <Field label="数据所有人" value={doc.asset_owner_name} icon={<User size={14} />} />}
          {doc.uploader_name && <Field label="上传人" value={doc.uploader_name} icon={<User size={14} />} />}
          {doc.file_type && <Field label="文件类型" value={doc.file_type.toUpperCase()} />}
          <Field label="时间" value={new Date(doc.synced_at || doc.created_at).toLocaleString('zh-CN')} />

          {/* 标签 */}
          <div>
            <p className="text-sm text-gray-500 mb-1">标签</p>
            <TagChips contentType="document" contentId={doc.id} editable />
          </div>

          {/* 关键词 */}
          {doc.keywords && doc.keywords.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">关键词</p>
              <div className="flex flex-wrap gap-1.5">
                {doc.keywords.map((kw, i) => (
                  <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {/* 自定义提取内容 */}
          {doc.key_info && Object.keys(doc.key_info).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">自定义提取内容</p>
              <div className="space-y-1.5 bg-indigo-50 rounded-lg p-3">
                {Object.entries(doc.key_info).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2 text-sm">
                    <span className="text-indigo-600 font-medium shrink-0">{k}:</span>
                    <span className="text-gray-800">{v == null || v === 'null' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                {doc.source_url && (
                  <a
                    href={doc.source_url}
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
