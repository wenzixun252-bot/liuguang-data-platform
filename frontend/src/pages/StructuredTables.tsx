import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Search, ChevronLeft, ChevronRight, X, Trash2, RefreshCw,
  ExternalLink, Table2, Download,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { TagFilter, BatchTagBar, TagChips, useContentTags, InlineTagEditor } from '../components/TagManager'

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
  cleaning_rule_id?: number | null
  cleaning_rule_name?: string | null
  uploader_name: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
}

interface StructuredTableDetail extends StructuredTableItem {
  source_app_token: string | null
  source_table_id: string | null
  schema_info: { field_id: string; field_name: string; field_type: string | number }[] | null
  keywords: string[]
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
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)

  // 穿透搜索
  const [globalSearch, setGlobalSearch] = useState('')
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

  const [tagFilter, setTagFilter] = useState<number[]>([])
  const [tagRefreshKey, setTagRefreshKey] = useState(0)
  const navigate = useNavigate()

  const pageSize = 20

  /* ── 加载分类列表 ─────────────────────────────── */

  useEffect(() => {
    api.get('/structured-tables/categories')
      .then((res) => setCategories(res.data.categories || []))
      .catch(() => {})
  }, [refreshKey])

  /* ── 加载表格列表 ─────────────────────────────── */

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (sourceFilter) params.source_type = sourceFilter
    if (categoryFilter) params.table_category = categoryFilter
    if (tagFilter.length > 0) params.tag_ids = tagFilter

    api.get('/structured-tables', { params })
      .then((res) => {
        setItems(res.data.items)
        setTotal(res.data.total)
      })
      .catch(() => toast.error('加载表格列表失败'))
      .finally(() => setLoading(false))
  }, [page, search, sourceFilter, categoryFilter, tagFilter, refreshKey])

  useEffect(() => { setSelectedIds(new Set()) }, [page, search, sourceFilter, categoryFilter, tagFilter])

  // 从搜索结果跳转过来时自动打开详情
  useEffect(() => {
    const highlightId = searchParams.get('highlight')
    if (highlightId && items.length > 0) {
      openDetail(Number(highlightId))
      setSearchParams({}, { replace: true })
    }
  }, [items, searchParams, setSearchParams])

  const totalPages = Math.ceil(total / pageSize)
  const currentIds = items.map((i) => i.id)
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id))
  const { tagsMap, reloadTags } = useContentTags('structured_table', currentIds, tagRefreshKey)

  /* ── 穿透搜索 ──────────────────────────────────── */

  const doGlobalSearch = useCallback((keyword: string, p: number) => {
    if (!keyword.trim()) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    api.get('/structured-tables/search', { params: { q: keyword, page: p, page_size: pageSize } })
      .then((res) => {
        setSearchResults(res.data.results)
        setSearchTotal(res.data.total)
      })
      .catch(() => toast.error('搜索失败'))
      .finally(() => setSearching(false))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchPage(1)
      doGlobalSearch(globalSearch, 1)
    }, 400)
    return () => clearTimeout(timer)
  }, [globalSearch, doGlobalSearch])

  /* ── 详情加载 ─────────────────────────────────── */

  const openDetail = async (id: number) => {
    try {
      setDetailLoading(true)
      const [detailRes, rowsRes] = await Promise.all([
        api.get(`/structured-tables/${id}`),
        api.get(`/structured-tables/${id}/rows`, { params: { page: 1, page_size: pageSize } }),
      ])
      setDetail(detailRes.data)
      setDetailRows(rowsRes.data.items)
      setDetailRowsTotal(rowsRes.data.total)
      setDetailPage(1)
      setDetailSearch('')
    } catch {
      toast.error('加载详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const loadDetailRows = async (tableId: number, p: number, s: string) => {
    try {
      const params: Record<string, unknown> = { page: p, page_size: pageSize }
      if (s) params.search = s
      const res = await api.get(`/structured-tables/${tableId}/rows`, { params })
      setDetailRows(res.data.items)
      setDetailRowsTotal(res.data.total)
    } catch {
      toast.error('加载行数据失败')
    }
  }

  useEffect(() => {
    if (detail) loadDetailRows(detail.id, detailPage, detailSearch)
  }, [detailPage])

  useEffect(() => {
    if (!detail) return
    const timer = setTimeout(() => {
      setDetailPage(1)
      loadDetailRows(detail.id, 1, detailSearch)
    }, 400)
    return () => clearTimeout(timer)
  }, [detailSearch])

  /* ── 操作 ──────────────────────────────────────── */

  const handleSync = async (id: number) => {
    try {
      await api.post(`/structured-tables/${id}/sync`)
      toast.success('同步成功')
      setRefreshKey((k) => k + 1)
      if (detail?.id === id) openDetail(id)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '同步失败')
    }
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
      const downloadName = name.endsWith('.xlsx') ? name : `${name}.xlsx`
      link.setAttribute('download', downloadName)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('导出成功')
    } catch {
      toast.error('导出失败')
    }
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
    } catch {
      toast.error('无原始文件')
    }
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
        <h1 className="text-2xl font-bold text-gray-800">表格数据</h1>
      </div>

      {/* 穿透搜索 */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="穿透搜索所有表格内容..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
      </div>

      {/* 穿透搜索结果 */}
      {searchResults !== null && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              搜索结果: 共 {searchTotal} 条匹配
            </span>
            <button onClick={() => { setGlobalSearch(''); setSearchResults(null) }} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          {searching ? (
            <div className="p-6 text-center text-gray-400">搜索中...</div>
          ) : searchResults.length === 0 ? (
            <div className="p-6 text-center text-gray-400">无匹配结果</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {searchResults.map((r) => (
                <div
                  key={r.row_id}
                  className="px-4 py-3 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                  onClick={() => openDetail(r.table_id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Table2 size={14} className="text-indigo-500" />
                    <span className="text-xs text-indigo-600 font-medium">{r.table_name}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {Object.entries(r.row_data).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-gray-400">{k}: </span>
                        <span className={r.matched_fields.includes(k) ? 'text-indigo-700 font-medium bg-indigo-50 px-1 rounded' : 'text-gray-700'}>
                          {String(v ?? '')}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {searchTotal > pageSize && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">第 {searchPage}/{Math.ceil(searchTotal / pageSize)} 页</span>
              <div className="flex items-center gap-2">
                <button onClick={() => { const p = Math.max(1, searchPage - 1); setSearchPage(p); doGlobalSearch(globalSearch, p) }} disabled={searchPage <= 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <button onClick={() => { const p = Math.min(Math.ceil(searchTotal / pageSize), searchPage + 1); setSearchPage(p); doGlobalSearch(globalSearch, p) }} disabled={searchPage >= Math.ceil(searchTotal / pageSize)} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 sm:flex-initial">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="按表名搜索..."
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
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
          <option value="bitable">飞书多维表格</option>
          <option value="spreadsheet">飞书表格</option>
          <option value="local">本地上传</option>
        </select>
        {categories.length > 0 && (
          <select
            title="表格分类筛选"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
          >
            <option value="">全部分类</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
      </div>

      {/* 标签筛选 */}
      <TagFilter selectedTagIds={tagFilter} onChange={(ids) => { setTagFilter(ids); setPage(1) }} />

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg flex-wrap">
          <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 项</span>
          <BatchTagBar
            selectedIds={selectedIds}
            contentType="structured_table"
            onDone={() => setRefreshKey((k) => k + 1)}
          />
          <button onClick={handleBatchDelete} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm">
            <Trash2 size={14} /> 批量删除
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">取消选择</button>
        </div>
      )}

      {/* 表格列表 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3 px-4 w-10">
                      <input type="checkbox" checked={allSelected} onChange={() => {
                        if (allSelected) setSelectedIds(new Set())
                        else setSelectedIds(new Set(currentIds))
                      }} className="rounded" />
                    </th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">表名</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">标签</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">来源</th>
                    <th className="text-left py-3 px-4 text-indigo-700 font-semibold bg-indigo-50/50">资产所有人</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">记录数</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">字段数</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">摘要</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">同步/上传时间</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-t border-gray-50 hover:bg-indigo-50/50 cursor-pointer transition-colors ${selectedIds.has(item.id) ? 'bg-indigo-50/30' : ''}`}
                      onClick={() => openDetail(item.id)}
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => {
                          const next = new Set(selectedIds)
                          if (next.has(item.id)) next.delete(item.id)
                          else next.add(item.id)
                          setSelectedIds(next)
                        }} className="rounded" />
                      </td>
                      <td className="py-3 px-4 max-w-[240px]">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="text-gray-800 font-medium truncate">{item.name}</span>
                          {(item.import_count ?? 1) > 1 && (
                            <span
                              className={`shrink-0 px-1.5 py-0.5 rounded text-xs border ${
                                item.import_count >= 10
                                  ? 'bg-amber-50 text-amber-700 border-amber-300 font-semibold'
                                  : item.import_count >= 5
                                    ? 'bg-purple-50 text-purple-600 border-purple-200'
                                    : 'bg-indigo-50 text-indigo-600 border-indigo-200'
                              }`}
                              title={`${item.import_count} 人已归档此表格`}
                            >
                              {item.import_count >= 10 ? '🔥 ' : ''}{item.import_count} 人归档
                            </span>
                          )}
                          {item.cleaning_rule_id ? (
                            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-600 border border-green-200" title={item.cleaning_rule_name || '已清洗'}>
                              {item.cleaning_rule_name || '已清洗'}
                            </span>
                          ) : (
                            <span className="shrink-0 px-1.5 py-0.5 rounded text-xs bg-gray-50 text-gray-400 border border-gray-200">
                              未清洗
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 max-w-[200px]" onClick={(e) => e.stopPropagation()}>
                        <InlineTagEditor
                          contentType="structured_table"
                          contentId={item.id}
                          tags={tagsMap[item.id] || []}
                          onChanged={() => { reloadTags(); setTagRefreshKey(k => k + 1) }}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs ${SOURCE_COLORS[item.source_type] || 'bg-gray-50 text-gray-700'}`}>
                          {SOURCE_LABELS[item.source_type] || item.source_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-indigo-700 font-medium bg-indigo-50/30">{item.uploader_name || '-'}</td>
                      <td className="py-3 px-4 text-gray-500">{item.row_count}</td>
                      <td className="py-3 px-4 text-gray-500">{item.column_count}</td>
                      <td className="py-3 px-4 text-gray-500 max-w-[200px] truncate">{item.summary || '-'}</td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                        {item.synced_at ? new Date(item.synced_at).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {item.source_type === 'local' && (
                            <button onClick={() => handleExport(item.id, item.name)} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="下载 XLSX">
                              <Download size={14} />
                            </button>
                          )}
                          {item.source_url && (
                            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="跳转源表格">
                              <ExternalLink size={14} />
                            </a>
                          )}
                          {item.source_type !== 'local' && (
                            <button onClick={() => handleSync(item.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="重新同步">
                              <RefreshCw size={14} />
                            </button>
                          )}
                          <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="删除">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">共 {total} 条，第 {page}/{totalPages} 页</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-12 text-center text-gray-400">
            <p>暂无表格数据</p>
            <button
              type="button"
              onClick={() => navigate('/data-import')}
              className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
            >
              前往数据导入
            </button>
          </div>
        )}
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <TableDetailPanel
          detail={detail}
          rows={detailRows}
          rowsTotal={detailRowsTotal}
          rowPage={detailPage}
          rowSearch={detailSearch}
          pageSize={pageSize}
          loading={detailLoading}
          onClose={() => setDetail(null)}
          onPageChange={setDetailPage}
          onSearchChange={setDetailSearch}
          onSync={() => handleSync(detail.id)}
          onDelete={() => handleDelete(detail.id)}
          onExport={handleExport}
          onDownloadOriginal={handleDownloadOriginal}
        />
      )}

    </div>
  )
}

/* ── 详情面板 ─────────────────────────────────── */

function TableDetailPanel({
  detail, rows, rowsTotal, rowPage, rowSearch, pageSize, loading,
  onClose, onPageChange, onSearchChange, onSync, onDelete, onExport, onDownloadOriginal,
}: {
  detail: StructuredTableDetail
  rows: RowItem[]
  rowsTotal: number
  rowPage: number
  rowSearch: string
  pageSize: number
  loading: boolean
  onClose: () => void
  onPageChange: (p: number) => void
  onSearchChange: (s: string) => void
  onSync: () => void
  onDelete: () => void
  onExport: (id: number, name: string) => void
  onDownloadOriginal: (id: number, name: string) => void
}) {
  // 构建 field_id -> field_name 映射，用于把原始字段ID翻译成中文
  const fieldIdToName: Record<string, string> = {}
  if (detail.schema_info) {
    detail.schema_info.forEach((s) => {
      fieldIdToName[s.field_id] = s.field_name
      fieldIdToName[s.field_name] = s.field_name // 兼容已经是中文名的情况
    })
  }
  // columnKeys: 用于访问 row_data 的实际 key（field_id 或 field_name）
  const columnKeys = detail.schema_info?.map((s) => s.field_name) || (rows.length > 0 ? Object.keys(rows[0].row_data) : [])
  // 显示用的列名：优先用中文 field_name
  const getColumnLabel = (key: string) => fieldIdToName[key] || key
  const rowTotalPages = Math.ceil(rowsTotal / pageSize)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-4xl bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">{detail.name}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className={`px-2 py-0.5 rounded-full text-xs ${SOURCE_COLORS[detail.source_type] || ''}`}>
                {SOURCE_LABELS[detail.source_type] || detail.source_type}
              </span>
              <span>{detail.row_count} 行 × {detail.column_count} 列</span>
              {detail.synced_at && <span>同步: {new Date(detail.synced_at).toLocaleString('zh-CN')}</span>}
              {detail.cleaning_rule_id ? (
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-600 border border-green-200">
                  {detail.cleaning_rule_name || '已清洗'}
                </span>
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
              <a href={detail.source_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100">
                <ExternalLink size={14} /> 源表格
              </a>
            )}
            <button onClick={onDelete} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={20} /></button>
          </div>
        </div>

        {/* 标签 */}
        <div className="px-6 py-3 border-b border-gray-100">
          <TagChips contentType="structured_table" contentId={detail.id} editable />
        </div>

        {/* 摘要 */}
        {detail.summary && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
            <p className="text-sm text-blue-800">{detail.summary}</p>
          </div>
        )}

        {/* 关键词 */}
        {detail.keywords && detail.keywords.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100">
            <div className="flex flex-wrap gap-1.5">
              {detail.keywords.map((kw, i) => (
                <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">{kw}</span>
              ))}
            </div>
          </div>
        )}

        {/* 行搜索 */}
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

        {/* 表格预览 */}
        <div className="px-6 py-4">
          {loading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : rows.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-3 text-gray-500 font-medium text-xs whitespace-nowrap">#</th>
                    {columnKeys.map((col) => (
                      <th key={col} className="text-left py-2 px-3 text-gray-500 font-medium text-xs whitespace-nowrap">{getColumnLabel(col)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-400 text-xs">{row.row_index + 1}</td>
                      {columnKeys.map((col) => (
                        <td key={col} className="py-2 px-3 text-gray-700 max-w-[200px] truncate">{String(row.row_data[col] ?? '')}</td>
                      ))}
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
        </div>
      </div>
    </div>
  )
}

