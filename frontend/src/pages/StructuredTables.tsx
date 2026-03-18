import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Search, ChevronLeft, ChevronRight, X, Trash2, RefreshCw,
  ExternalLink, Table2, Download, Upload, Eye,
} from 'lucide-react'
import api, { getExtractionRules } from '../lib/api'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { BatchTagBar, TagChips, useContentTags, InlineTagEditor, TagFilter } from '../components/TagManager'
import { ColumnFilter } from '../components/ColumnFilter'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { HighlightText } from '../components/HighlightText'
import { DataTable, type DataTableColumn, getPersistedDisplayCount } from '../components/DataTable'
import ArchiverPopover from '../components/ArchiverPopover'
import ExtractionRuleSlicer from '../components/ExtractionRuleSlicer'

const ExtractionFieldView = lazy(() => import('../components/ExtractionFieldView'))

/* ── 类型定义 ────────────────────────────────── */

interface StructuredTableItem {
  id: number
  owner_id: string
  name: string
  description: string | null
  summary: string | null
  source_type: string
  source_url: string | null
  file_name: string | null
  file_path: string | null
  row_count: number
  column_count: number
  import_count: number
  key_info?: Record<string, string> | null
  extraction_rule_id?: number | null
  cleaning_rule_id?: number | null
  cleaning_rule_name?: string | null
  asset_owner_name: string | null
  uploader_name: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
}

interface StructuredTableDetail extends StructuredTableItem {
  source_app_token: string | null
  source_table_id: string | null
  schema_info: { field_id: string; field_name: string; field_type: string | number }[] | Record<string, unknown> | null
  keywords: string[]
  key_info?: Record<string, string> | null
  sheet_names?: string[] | null
}

interface RowItem {
  id: number
  row_index: number
  row_data: Record<string, unknown>
}

interface SearchResultItem {
  table_id: number
  table_name: string
  row_id: number
  row_index: number
  row_data: Record<string, unknown>
  matched_fields: string[]
}

/* ── 来源标签 ─────────────────────────────────── */

const SOURCE_LABELS: Record<string, string> = {
  bitable: '飞书多维表格',
  spreadsheet: '飞书表格',
  local: '本地上传',
}
const SOURCE_COLORS: Record<string, string> = {
  bitable: 'bg-blue-50 text-blue-700',
  spreadsheet: 'bg-purple-50 text-purple-700',
  local: 'bg-green-50 text-green-700',
}

/* ── 主页面 ───────────────────────────────────── */

export default function StructuredTables() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<StructuredTableItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [displayCount, setDisplayCount] = useState(() => getPersistedDisplayCount('structured-tables'))
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({})
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({})
  const [tagIds, setTagIds] = useState<number[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [extractionRuleId, setExtractionRuleId] = useState<number | null>(null)
  const [fieldViewRuleId, setFieldViewRuleId] = useState<number | null>(null)

  // 提取规则名称映射
  const { data: rulesList } = useQuery({ queryKey: ['extraction-rules'], queryFn: getExtractionRules })
  const rulesMap: Record<number, string> = {}
  if (Array.isArray(rulesList)) {
    rulesList.forEach((r: any) => { rulesMap[r.id] = r.name })
  }

  const detailPageSize = 20 // 穿透搜索和详情面板的分页大小

  // 穿透搜索
  const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchPage, setSearchPage] = useState(1)
  const [searching, setSearching] = useState(false)

  // 详情弹窗
  const [detail, setDetail] = useState<StructuredTableDetail | null>(null)
  const [detailRows, setDetailRows] = useState<RowItem[]>([])
  const [detailRowsTotal, setDetailRowsTotal] = useState(0)
  const [detailPage, setDetailPage] = useState(1)
  const [detailSearch, setDetailSearch] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [activeSheet, setActiveSheet] = useState<string>('')

  const [tagRefreshKey, setTagRefreshKey] = useState(0)
  const navigate = useNavigate()

  const currentIds = items.map((i) => i.id)
  const { tagsMap, reloadTags } = useContentTags('structured_table', currentIds, tagRefreshKey)


  const sourceTypeOptions = ['bitable', 'spreadsheet', 'local']

  const uniqueValues = (key: string) => {
    const vals = new Set<string>()
    for (const item of items) {
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

  /* ── DataTable 列定义 ──────────────────────── */

  const tableColumns = useMemo<DataTableColumn<StructuredTableItem>[]>(() => [
    {
      key: 'name',
      label: '表名',
      width: 260,
      minWidth: 160,
      frozen: true,
      sortable: true,
      cell: (item) => (
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="text-gray-800 font-medium truncate">{item.name}</span>
          {(item.import_count ?? 1) > 1 && (
            <ArchiverPopover contentType="structured_table" contentId={item.id} importCount={item.import_count} />
          )}
          {item.extraction_rule_id && rulesMap[item.extraction_rule_id] && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-violet-50 text-violet-700 border border-violet-200 font-medium">
              {rulesMap[item.extraction_rule_id]}
            </span>
          )}
          {item.cleaning_rule_id ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-600 border border-green-200" title={item.cleaning_rule_name || '已清洗'}>
              {item.cleaning_rule_name || '已清洗'}
            </span>
          ) : (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-gray-50 text-gray-400 border border-gray-200">未清洗</span>
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
          contentType="structured_table"
          contentId={item.id}
          tags={tagsMap[item.id] || []}
          onChanged={() => { reloadTags(); setTagRefreshKey(k => k + 1) }}
        />
      ),
    },
    {
      key: 'summary',
      label: '摘要',
      width: 220,
      cell: (item) => <span className="text-gray-500">{item.summary || '-'}</span>,
    },
    {
      key: 'key_info',
      label: '自定义提取内容',
      width: 300,
      headerClassName: 'text-violet-700 font-semibold bg-violet-50/50',
      cellClassName: () => 'bg-violet-50/30',
      cell: (item) => {
        if (!item.key_info || Object.keys(item.key_info).length === 0) {
          return <span className="text-gray-300 text-xs">-</span>
        }
        return (
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
        )
      },
    },
    {
      key: 'source_type',
      label: '来源',
      width: 130,
      headerExtra: <ColumnFilter options={sourceTypeOptions} selected={columnFilters.source_type || []} onChange={(v) => updateColumnFilter('source_type', v)} />,
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs ${SOURCE_COLORS[item.source_type] || 'bg-gray-50 text-gray-700'}`}>
          {SOURCE_LABELS[item.source_type] || item.source_type}
        </span>
      ),
    },
    {
      key: 'asset_owner_name',
      label: '数据所有人',
      width: 130,
      headerClassName: 'text-indigo-700 font-semibold bg-indigo-50/50',
      cellClassName: () => 'bg-indigo-50/30',
      headerExtra: <ColumnFilter options={uniqueValues('asset_owner_name')} selected={columnFilters.asset_owner_name || []} onChange={(v) => updateColumnFilter('asset_owner_name', v)} />,
      cell: (item) => <span className="text-indigo-700 font-medium">{item.asset_owner_name || '-'}</span>,
    },
    {
      key: 'uploader_name',
      label: '上传人',
      width: 110,
      headerExtra: <ColumnFilter options={uniqueValues('uploader_name')} selected={columnFilters.uploader_name || []} onChange={(v) => updateColumnFilter('uploader_name', v)} />,
      cell: (item) => <span className="text-gray-600">{item.uploader_name || '-'}</span>,
    },
    {
      key: 'row_count',
      label: '记录数',
      width: 80,
      sortable: true,
      cell: (item) => <span className="text-gray-500">{item.row_count}</span>,
    },
    {
      key: 'column_count',
      label: '字段数',
      width: 80,
      cell: (item) => <span className="text-gray-500">{item.column_count}</span>,
    },
    {
      key: 'synced_at',
      label: '同步/上传时间',
      width: 160,
      sortable: true,
      headerExtra: <DateRangeFilter from={dateFilters.synced_at?.from || ''} to={dateFilters.synced_at?.to || ''} onChange={(f, t) => updateDateFilter('synced_at', f, t)} />,
      cell: (item) => <span className="text-gray-500 whitespace-nowrap">{item.synced_at ? new Date(item.synced_at).toLocaleString('zh-CN') : '-'}</span>,
    },
    {
      key: 'actions',
      label: '操作',
      width: 150,
      minWidth: 120,
      cell: (item) => (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => openDetail(item.id)} className="p-1.5 hover:bg-indigo-50 rounded-lg text-indigo-600" title="查看详情">
            <Eye size={14} />
          </button>
          {item.source_type === 'local' && (
            <button onClick={() => handleExport(item.id, item.name)} className="p-1.5 hover:bg-green-50 rounded-lg text-green-600" title="下载 XLSX">
              <Download size={14} />
            </button>
          )}
          {item.source_url && (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="跳转源表格">
              <ExternalLink size={14} />
            </a>
          )}
          {item.source_type !== 'local' && (
            <button onClick={() => handleSync(item.id)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="重新同步">
              <RefreshCw size={14} />
            </button>
          )}
          <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="删除">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ], [tagsMap, columnFilters, dateFilters, reloadTags, items])

  /* ── 加载表格列表 ─────────────────────────────── */

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page: 1, page_size: displayCount }
    if (search) params.search = search
    if (tagIds.length > 0) params.tag_ids = tagIds
    if (extractionRuleId) params.extraction_rule_id = extractionRuleId
    for (const [key, vals] of Object.entries(columnFilters)) {
      if (vals.length > 0) params[key] = vals.join(',')
    }
    for (const [field, range] of Object.entries(dateFilters)) {
      if (range.from || range.to) {
        params.date_field = field
        if (range.from) params.date_from = range.from + 'T00:00:00'
        if (range.to) params.date_to = range.to + 'T23:59:59'
        break
      }
    }
    api.get('/structured-tables', { params })
      .then((res) => { setItems(res.data.items); setTotal(res.data.total) })
      .catch(() => toast.error('加载表格列表失败'))
      .finally(() => setLoading(false))
  }, [displayCount, search, columnFilters, dateFilters, tagIds, extractionRuleId, refreshKey])

  useEffect(() => { setSelectedIds(new Set()) }, [search, columnFilters, dateFilters, tagIds, extractionRuleId])

  useEffect(() => {
    const highlightId = searchParams.get('highlight')
    if (highlightId && items.length > 0) {
      openDetail(Number(highlightId))
      setSearchParams({}, { replace: true })
    }
  }, [items, searchParams, setSearchParams])

  /* ── 穿透搜索 ──────────────────────────────────── */

  const doGlobalSearch = useCallback((keyword: string, p: number) => {
    if (!keyword.trim()) { setSearchResults(null); return }
    setSearching(true)
    api.get('/structured-tables/search', { params: { q: keyword, page: p, page_size: detailPageSize } })
      .then((res) => { setSearchResults(res.data.results); setSearchTotal(res.data.total) })
      .catch(() => toast.error('搜索失败'))
      .finally(() => setSearching(false))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { setSearchPage(1); doGlobalSearch(search, 1) }, 400)
    return () => clearTimeout(timer)
  }, [search, doGlobalSearch])

  /* ── 详情加载 ─────────────────────────────────── */

  const openDetail = async (id: number) => {
    try {
      setDetailLoading(true)
      const detailRes = await api.get(`/structured-tables/${id}`)
      const detailData = detailRes.data
      setDetail(detailData)
      // 如果有多 sheet，默认选第一个
      const firstSheet = detailData.sheet_names?.[0] || ''
      setActiveSheet(firstSheet)
      const rowParams: Record<string, unknown> = { page: 1, page_size: detailPageSize }
      if (firstSheet) rowParams.sheet_name = firstSheet
      const rowsRes = await api.get(`/structured-tables/${id}/rows`, { params: rowParams })
      setDetailRows(rowsRes.data.items)
      setDetailRowsTotal(rowsRes.data.total)
      setDetailPage(1)
      setDetailSearch('')
    } catch { toast.error('加载详情失败') }
    finally { setDetailLoading(false) }
  }

  const loadDetailRows = async (tableId: number, p: number, s: string, sheetName?: string) => {
    try {
      const params: Record<string, unknown> = { page: p, page_size: detailPageSize }
      if (s) params.search = s
      const sn = sheetName ?? activeSheet
      if (sn) params.sheet_name = sn
      const res = await api.get(`/structured-tables/${tableId}/rows`, { params })
      setDetailRows(res.data.items)
      setDetailRowsTotal(res.data.total)
    } catch { toast.error('加载行数据失败') }
  }

  useEffect(() => { if (detail) loadDetailRows(detail.id, detailPage, detailSearch) }, [detailPage])
  useEffect(() => {
    if (!detail) return
    const timer = setTimeout(() => { setDetailPage(1); loadDetailRows(detail.id, 1, detailSearch) }, 400)
    return () => clearTimeout(timer)
  }, [detailSearch])

  /* ── 操作 ──────────────────────────────────────── */

  const handleSync = async (id: number) => {
    try {
      await api.post(`/structured-tables/${id}/sync`)
      toast.success('同步成功')
      setRefreshKey((k) => k + 1)
      if (detail?.id === id) openDetail(id)
    } catch (err: any) { toast.error(err?.response?.data?.detail || '同步失败') }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此表格吗？')) return
    try {
      await api.delete(`/structured-tables/${id}`)
      toast.success('已删除')
      if (detail?.id === id) setDetail(null)
      setRefreshKey((k) => k + 1)
    } catch { toast.error('删除失败') }
  }

  const handleExport = async (id: number, name: string) => {
    try {
      const response = await api.get(`/structured-tables/${id}/export`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', name.endsWith('.xlsx') ? name : `${name}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('导出成功')
    } catch { toast.error('导出失败') }
  }

  const handleDownloadOriginal = async (id: number, name: string) => {
    try {
      const response = await api.get(`/structured-tables/${id}/download-original`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', name)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('下载成功')
    } catch { toast.error('无原始文件') }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个表格吗？`)) return
    try {
      const res = await api.post('/structured-tables/batch-delete', { ids: Array.from(selectedIds) })
      toast.success(`已删除 ${res.data.deleted} 个`)
      setSelectedIds(new Set())
      setRefreshKey((k) => k + 1)
    } catch { toast.error('批量删除失败') }
  }

  /* ── 渲染 ──────────────────────────────────────── */

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">表格数据</h1>
          <button
            type="button"
            onClick={() => navigate('/data-import')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Upload size={14} />
            导入数据
          </button>
        </div>
        <div className="relative w-full sm:w-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="搜索表名或表内数据..."
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 穿透搜索结果 */}
      {searchResults !== null && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">搜索结果: 共 {searchTotal} 条匹配</span>
            <button onClick={() => { setSearch(''); setSearchResults(null) }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          {searching ? (
            <div className="p-6 text-center text-gray-400">搜索中...</div>
          ) : searchResults.length === 0 ? (
            <div className="p-6 text-center text-gray-400">无匹配结果</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {searchResults.map((r) => (
                <div key={r.row_id} className="px-4 py-3 hover:bg-indigo-50/50 cursor-pointer transition-colors" onClick={() => openDetail(r.table_id)}>
                  <div className="flex items-center gap-2 mb-1">
                    <Table2 size={14} className="text-indigo-500" />
                    <span className="text-xs text-indigo-600 font-medium">{r.table_name}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {Object.entries(r.row_data).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-gray-400">{k}: </span>
                        <span className={r.matched_fields.includes(k) ? 'text-indigo-700 font-medium bg-indigo-50 px-1 rounded' : 'text-gray-700'}>
                          <HighlightText text={String(v ?? '')} keyword={search} />
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {searchTotal > detailPageSize && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">第 {searchPage}/{Math.ceil(searchTotal / detailPageSize)} 页</span>
              <div className="flex items-center gap-2">
                <button onClick={() => { const p = Math.max(1, searchPage - 1); setSearchPage(p); doGlobalSearch(search, p) }} disabled={searchPage <= 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <button onClick={() => { const p = Math.min(Math.ceil(searchTotal / detailPageSize), searchPage + 1); setSearchPage(p); doGlobalSearch(search, p) }} disabled={searchPage >= Math.ceil(searchTotal / detailPageSize)} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </div>
      )}

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
          <BatchTagBar selectedIds={selectedIds} contentType="structured_table" onDone={() => setRefreshKey((k) => k + 1)} />
          <button onClick={handleBatchDelete} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm">
            <Trash2 size={14} /> 批量删除
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">取消选择</button>
        </div>
      )}

      {/* DataTable */}
      <DataTable<StructuredTableItem>
        columns={tableColumns}
        data={items}
        rowKey={(item) => item.id}
        loading={loading}
        storageKey="structured-tables"
        search={search}
        reorderable
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onRowClick={(item) => openDetail(item.id)}
        activeRowId={detail?.id}
        total={total}
        displayCount={displayCount}
        onDisplayCountChange={setDisplayCount}
        emptyContent={
          <div>
            <p>暂无表格数据</p>
            <button type="button" onClick={() => navigate('/data-import')} className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium">
              前往数据归档
            </button>
          </div>
        }
      />

      {/* 详情弹窗 */}
      {detail && (
        <TableDetailPanel
          detail={detail}
          rows={detailRows}
          rowsTotal={detailRowsTotal}
          rowPage={detailPage}
          rowSearch={detailSearch}
          detailPageSize={detailPageSize}
          loading={detailLoading}
          activeSheet={activeSheet}
          onSheetChange={(sn) => {
            setActiveSheet(sn)
            setDetailPage(1)
            setDetailSearch('')
            loadDetailRows(detail.id, 1, '', sn)
          }}
          onClose={() => setDetail(null)}
          onPageChange={setDetailPage}
          onSearchChange={setDetailSearch}
          onSync={() => handleSync(detail.id)}
          onDelete={() => handleDelete(detail.id)}
          onExport={handleExport}
          onDownloadOriginal={handleDownloadOriginal}
        />
      )}

      {/* 字段视图 */}
      {fieldViewRuleId && (
        <Suspense fallback={null}>
          <ExtractionFieldView ruleId={fieldViewRuleId} onClose={() => setFieldViewRuleId(null)} />
        </Suspense>
      )}
    </div>
  )
}

/* ── 详情面板 ─────────────────────────────────── */

function TableDetailPanel({
  detail, rows, rowsTotal, rowPage, rowSearch, detailPageSize, loading,
  activeSheet, onSheetChange,
  onClose, onPageChange, onSearchChange, onSync, onDelete, onExport, onDownloadOriginal,
}: {
  detail: StructuredTableDetail
  rows: RowItem[]
  rowsTotal: number
  rowPage: number
  rowSearch: string
  detailPageSize: number
  loading: boolean
  activeSheet: string
  onSheetChange: (sheetName: string) => void
  onClose: () => void
  onPageChange: (p: number) => void
  onSearchChange: (s: string) => void
  onSync: () => void
  onDelete: () => void
  onExport: (id: number, name: string) => void
  onDownloadOriginal: (id: number, name: string) => void
}) {
  const sheetNames = detail.sheet_names || []
  const isMultiSheet = sheetNames.length > 1

  // 根据当前 sheet 获取对应的 schema_info
  const getSchemaForSheet = () => {
    if (!detail.schema_info) return null
    // 多 sheet 格式：{ __sheets__: { sheetName: [...fields] } }
    const sheetsMap = (detail.schema_info as Record<string, unknown>).__sheets__
    if (sheetsMap && typeof sheetsMap === 'object' && activeSheet) {
      const fields = (sheetsMap as Record<string, { field_id: string; field_name: string; field_type: string | number }[]>)[activeSheet]
      return fields || null
    }
    // 单 sheet 格式：[...fields]
    if (Array.isArray(detail.schema_info)) return detail.schema_info
    return null
  }
  const currentSchema = getSchemaForSheet()

  const fieldIdToName: Record<string, string> = {}
  if (currentSchema) {
    currentSchema.forEach((s: { field_id: string; field_name: string }) => {
      fieldIdToName[s.field_id] = s.field_name
      fieldIdToName[s.field_name] = s.field_name
    })
  }
  const columnKeys = currentSchema?.map((s: { field_name: string }) => s.field_name) || (rows.length > 0 ? Object.keys(rows[0].row_data) : [])
  const getColumnLabel = (key: string) => fieldIdToName[key] || key
  const rowTotalPages = Math.ceil(rowsTotal / detailPageSize)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-4xl bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">{detail.name}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className={`px-2 py-0.5 rounded-full text-xs ${SOURCE_COLORS[detail.source_type] || ''}`}>
                {SOURCE_LABELS[detail.source_type] || detail.source_type}
              </span>
              <span>{detail.row_count} 行 × {detail.column_count} 列{isMultiSheet ? ` · ${sheetNames.length} 个工作表` : ''}</span>
              {detail.synced_at && <span>同步: {new Date(detail.synced_at).toLocaleString('zh-CN')}</span>}
              {detail.cleaning_rule_id ? (
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-600 border border-green-200">{detail.cleaning_rule_name || '已清洗'}</span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-50 text-gray-400 border border-gray-200">未清洗</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onExport(detail.id, detail.name)} className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm hover:bg-green-100">
              <Download size={14} /> {detail.cleaning_rule_id ? '下载清洗后' : '下载 XLSX'}
            </button>
            {detail.file_path && (
              <button onClick={() => onDownloadOriginal(detail.id, detail.file_name || detail.name)} className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-sm hover:bg-orange-100">
                <Download size={14} /> 下载原表格
              </button>
            )}
            {detail.source_type !== 'local' && (
              <button onClick={onSync} className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100">
                <RefreshCw size={14} /> 同步
              </button>
            )}
            {detail.source_url && (
              <a href={detail.source_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100">
                <ExternalLink size={14} /> 源表格
              </a>
            )}
            <button onClick={onDelete} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={20} /></button>
          </div>
        </div>
        <div className="px-6 py-3 border-b border-gray-100">
          <TagChips contentType="structured_table" contentId={detail.id} editable />
        </div>
        {detail.summary && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
            <p className="text-sm text-blue-800">{detail.summary}</p>
          </div>
        )}
        {detail.keywords && detail.keywords.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100">
            <div className="flex flex-wrap gap-1.5">
              {detail.keywords.map((kw, i) => <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">{kw}</span>)}
            </div>
          </div>
        )}
        {detail.key_info && Object.keys(detail.key_info).length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100">
            <p className="text-sm text-gray-500 mb-1">自定义提取内容</p>
            <div className="space-y-1.5 bg-violet-50 rounded-lg p-3">
              {Object.entries(detail.key_info).map(([k, v]) => (
                <div key={k} className="flex items-start gap-2 text-sm">
                  <span className="text-violet-600 font-medium shrink-0">{k}:</span>
                  <span className="text-gray-800">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="px-6 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索行内容..."
              className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={rowSearch}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>
        <div className="px-6 py-4">
          {loading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : rows.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-3 text-gray-500 font-medium text-xs whitespace-nowrap">#</th>
                    {columnKeys.map((col) => <th key={col} className="text-left py-2 px-3 text-gray-500 font-medium text-xs whitespace-nowrap">{getColumnLabel(col)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-400 text-xs">{row.row_index + 1}</td>
                      {columnKeys.map((col) => <td key={col} className="py-2 px-3 text-gray-700 max-w-[200px] truncate">{String(row.row_data[col] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">暂无数据</div>
          )}
          {rowTotalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm text-gray-500">共 {rowsTotal} 行，第 {rowPage}/{rowTotalPages} 页</span>
              <div className="flex items-center gap-2">
                <button onClick={() => onPageChange(Math.max(1, rowPage - 1))} disabled={rowPage <= 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <button onClick={() => onPageChange(Math.min(rowTotalPages, rowPage + 1))} disabled={rowPage >= rowTotalPages} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
          {/* Excel 风格 Sheet 标签栏 */}
          {isMultiSheet && (
            <div className="flex items-end gap-0 mt-4 border-t border-gray-200 pt-0 -mx-6 px-6 bg-gray-50">
              {sheetNames.map((sn) => (
                <button
                  key={sn}
                  onClick={() => onSheetChange(sn)}
                  className={`
                    relative px-4 py-2 text-sm font-medium border border-b-0 rounded-t-lg transition-colors
                    ${activeSheet === sn
                      ? 'bg-white text-indigo-700 border-gray-300 -mb-px z-10 shadow-sm'
                      : 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200 hover:text-gray-700'
                    }
                  `}
                >
                  {sn}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
