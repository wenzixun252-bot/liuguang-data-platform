import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search, ChevronLeft, ChevronRight, X, Trash2, RefreshCw,
  ExternalLink, Upload, Table2, Cloud, ChevronDown, Loader2,
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
  row_count: number
  column_count: number
  synced_at: string | null
  created_at: string
  updated_at: string
}

interface StructuredTableDetail extends StructuredTableItem {
  source_app_token: string | null
  source_table_id: string | null
  schema_info: { field_id: string; field_name: string; field_type: string | number }[] | null
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

  // 导入弹窗
  const [showLocalUpload, setShowLocalUpload] = useState(false)
  const [showFeishuImport, setShowFeishuImport] = useState(false)
  const [tagFilter, setTagFilter] = useState<number[]>([])
  const [tagRefreshKey, setTagRefreshKey] = useState(0)

  const pageSize = 20

  /* ── 加载表格列表 ─────────────────────────────── */

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (sourceFilter) params.source_type = sourceFilter
    if (tagFilter.length > 0) params.tag_ids = tagFilter

    api.get('/structured-tables', { params })
      .then((res) => {
        setItems(res.data.items)
        setTotal(res.data.total)
      })
      .catch(() => toast.error('加载表格列表失败'))
      .finally(() => setLoading(false))
  }, [page, search, sourceFilter, tagFilter, refreshKey])

  useEffect(() => { setSelectedIds(new Set()) }, [page, search, sourceFilter, tagFilter])

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLocalUpload(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
          >
            <Upload size={16} />
            导入本地数据
          </button>
          <button
            onClick={() => setShowFeishuImport(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
          >
            <Cloud size={16} />
            同步飞书数据
          </button>
        </div>
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
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">行数</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">列数</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">摘要</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">同步时间</th>
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
                      <td className="py-3 px-4 text-gray-800 font-medium max-w-[200px] truncate">{item.name}</td>
                      <td className="py-3 px-4 max-w-[200px]">
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
                      <td className="py-3 px-4 text-gray-500">{item.row_count}</td>
                      <td className="py-3 px-4 text-gray-500">{item.column_count}</td>
                      <td className="py-3 px-4 text-gray-500 max-w-[200px] truncate">{item.summary || '-'}</td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                        {item.synced_at ? new Date(item.synced_at).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
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
          <div className="p-12 text-center text-gray-400">暂无表格数据，点击上方按钮导入</div>
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
        />
      )}

      {/* 本地上传弹窗 */}
      {showLocalUpload && (
        <LocalUploadModal
          onClose={() => setShowLocalUpload(false)}
          onSuccess={() => { setShowLocalUpload(false); setRefreshKey((k) => k + 1) }}
        />
      )}

      {/* 飞书导入弹窗 */}
      {showFeishuImport && (
        <FeishuImportModal
          onClose={() => setShowFeishuImport(false)}
          onSuccess={() => { setShowFeishuImport(false); setRefreshKey((k) => k + 1) }}
        />
      )}
    </div>
  )
}

/* ── 详情面板 ─────────────────────────────────── */

function TableDetailPanel({
  detail, rows, rowsTotal, rowPage, rowSearch, pageSize, loading,
  onClose, onPageChange, onSearchChange, onSync, onDelete,
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
}) {
  const columns = detail.schema_info?.map((s) => s.field_name) || (rows.length > 0 ? Object.keys(rows[0].row_data) : [])
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
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                    {columns.map((col) => (
                      <th key={col} className="text-left py-2 px-3 text-gray-500 font-medium text-xs whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-400 text-xs">{row.row_index + 1}</td>
                      {columns.map((col) => (
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

/* ── 本地上传弹窗 ─────────────────────────────── */

function LocalUploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  const handleImport = async () => {
    if (!file) { toast.error('请选择文件'); return }
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.post('/structured-tables/import/upload', formData)
      toast.success('导入成功')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">导入本地数据</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <label className="block text-sm text-gray-600 mb-2">选择文件 (.csv / .xlsx / .xls / .json / .txt)</label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.json,.txt"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
          />
          {file && <p className="mt-2 text-sm text-gray-500">已选择: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">取消</button>
          <button
            onClick={handleImport}
            disabled={importing || !file}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {importing && <RefreshCw size={14} className="animate-spin" />}
            {importing ? '导入中...' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 飞书导入弹窗 ─────────────────────────────── */

function FeishuImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [importing, setImporting] = useState(false)

  // 可选列表
  const [bitables, setBitables] = useState<{ token: string; name: string; type: string }[]>([])
  const [selectedItem, setSelectedItem] = useState('')
  const [listSearch, setListSearch] = useState('')
  const [loadingList, setLoadingList] = useState(true)

  // 子表/工作表选择
  const [subTables, setSubTables] = useState<{ table_id: string; name: string }[]>([])
  const [selectedSubTable, setSelectedSubTable] = useState('')
  const [subTableSearch, setSubTableSearch] = useState('')

  const [sheets, setSheets] = useState<{ sheet_id: string; title: string }[]>([])
  const [selectedSheet, setSelectedSheet] = useState('')

  // 粘贴链接（兜底）
  const [showPasteUrl, setShowPasteUrl] = useState(false)
  const [pasteUrl, setPasteUrl] = useState('')
  const [urlParsed, setUrlParsed] = useState<{
    source_type: string; app_token: string; table_id?: string | null;
    tables?: { table_id: string; name: string }[];
    sheets?: { sheet_id: string; title: string }[];
  } | null>(null)
  const [urlParsing, setUrlParsing] = useState(false)
  const [urlSelectedTable, setUrlSelectedTable] = useState('')
  const [urlSelectedSheet, setUrlSelectedSheet] = useState('')

  // 加载多维表格 + 飞书表格合并列表（统一搜索 API）
  // 用请求序号防止慢请求覆盖新请求的结果
  const requestSeq = useRef(0)
  const loadList = useCallback(async (q = '') => {
    const seq = ++requestSeq.current
    setLoadingList(true)
    const merged: { token: string; name: string; type: string }[] = []
    try {
      const res = await api.get('/import/feishu-discover', { params: q ? { q } : {} })
      for (const f of res.data || []) {
        merged.push({ token: f.app_token, name: f.app_name, type: f.type || 'bitable' })
      }
    } catch { /* ignore */ }
    // 只有最新请求的结果才生效，避免慢的默认请求覆盖用户搜索结果
    if (seq === requestSeq.current) {
      setBitables(merged)
      setLoadingList(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  // 防抖：listSearch 变化后 500ms 重新调 API
  const isFirstListSearch = useRef(true)
  useEffect(() => {
    if (isFirstListSearch.current) {
      isFirstListSearch.current = false
      return
    }
    const timer = setTimeout(() => {
      loadList(listSearch)
    }, 500)
    return () => clearTimeout(timer)
  }, [listSearch, loadList])

  const handleSelectItem = async (token: string, type: string) => {
    setSelectedSubTable('')
    setSelectedSheet('')
    setSubTables([])
    setSheets([])

    let resolvedToken = token
    let resolvedType = type

    // wiki 类型：先解析实际类型
    if (type === 'wiki') {
      try {
        const res = await api.get(`/import/feishu-discover/wiki-resolve/${token}`)
        resolvedType = res.data.obj_type   // "bitable" | "sheet" | ...
        resolvedToken = res.data.obj_token
        // 更新列表中对应项的 token 和 type
        setBitables((prev) =>
          prev.map((b) =>
            b.token === token ? { ...b, token: resolvedToken, type: resolvedType } : b,
          ),
        )
      } catch {
        toast.error('无法解析该知识空间文档的类型')
        return
      }
    }

    // 非表格类型直接提示
    if (!['bitable', 'spreadsheet'].includes(resolvedType)) {
      toast.error(`该文件是 ${resolvedType} 类型，不是多维表格或电子表格，无法导入`)
      return
    }

    setSelectedItem(resolvedToken)

    if (resolvedType === 'bitable') {
      try {
        const res = await api.get(`/import/feishu-discover/${resolvedToken}/tables`)
        setSubTables((res.data || []).map((t: any) => ({ table_id: t.table_id, name: t.name })))
      } catch { toast.error('获取表列表失败') }
    } else {
      try {
        const res = await api.get(`/structured-tables/discover-sheets/${resolvedToken}`)
        setSheets(res.data.sheets || [])
      } catch { toast.error('获取工作表列表失败') }
    }
  }

  const handleParseUrl = async () => {
    if (!pasteUrl.trim()) { toast.error('请粘贴飞书链接'); return }
    setUrlParsing(true)
    setUrlParsed(null)
    setUrlSelectedTable('')
    setUrlSelectedSheet('')
    try {
      const res = await api.post('/structured-tables/parse-url', { url: pasteUrl })
      setUrlParsed(res.data)
      if (res.data.table_id) setUrlSelectedTable(res.data.table_id)
      if (res.data.tables?.length === 1) setUrlSelectedTable(res.data.tables[0].table_id)
      if (res.data.sheets?.length === 1) setUrlSelectedSheet(res.data.sheets[0].sheet_id)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '链接解析失败')
    } finally {
      setUrlParsing(false)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      if (showPasteUrl && urlParsed) {
        // 粘贴链接模式
        if (urlParsed.source_type === 'bitable') {
          if (!urlSelectedTable) { toast.error('请选择要导入的数据表'); setImporting(false); return }
          await api.post('/structured-tables/import/bitable', { app_token: urlParsed.app_token, table_id: urlSelectedTable })
        } else {
          if (!urlSelectedSheet) { toast.error('请选择要导入的工作表'); setImporting(false); return }
          await api.post('/structured-tables/import/spreadsheet', { spreadsheet_token: urlParsed.app_token, sheet_id: urlSelectedSheet })
        }
      } else {
        // 列表选择模式
        const item = bitables.find(b => b.token === selectedItem)
        if (!item) { toast.error('请选择一个表格'); setImporting(false); return }
        if (item.type === 'bitable') {
          if (!selectedSubTable) { toast.error('请选择数据表'); setImporting(false); return }
          await api.post('/structured-tables/import/bitable', { app_token: item.token, table_id: selectedSubTable })
        } else {
          if (!selectedSheet) { toast.error('请选择工作表'); setImporting(false); return }
          await api.post('/structured-tables/import/spreadsheet', { spreadsheet_token: item.token, sheet_id: selectedSheet })
        }
      }
      toast.success('导入成功')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const selectedType = bitables.find(b => b.token === selectedItem)?.type
  const filteredList = bitables

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">同步飞书数据</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* 可选列表 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">选择表格</label>
            <p className="text-xs text-gray-400 mb-2">同时展示多维表格和飞书表格</p>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="输入关键词自动搜索..."
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
              />
              {loadingList && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
            </div>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
              {loadingList ? (
                <div className="px-3 py-6 text-sm text-gray-400 text-center flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  正在加载...
                </div>
              ) : filteredList.length > 0 ? (
                filteredList.map((b) => (
                  <div
                    key={`${b.type}:${b.token}`}
                    onClick={() => handleSelectItem(b.token, b.type)}
                    className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${selectedItem === b.token ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                  >
                    <span className="flex-1 truncate">{b.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      b.type === 'bitable' ? 'bg-blue-50 text-blue-600' :
                      b.type === 'spreadsheet' ? 'bg-purple-50 text-purple-600' :
                      b.type === 'wiki' ? 'bg-orange-50 text-orange-600' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      {b.type === 'bitable' ? '多维表格' :
                       b.type === 'spreadsheet' ? '表格' :
                       b.type === 'wiki' ? '知识空间' :
                       b.type === 'docx' ? '文档' :
                       b.type}
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-gray-400 text-center">无匹配结果</div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">共 {bitables.length} 个表格</p>
          </div>

          {/* 子表/工作表 */}
          {!loadingList && (
            <>
              {selectedItem && selectedType === 'bitable' && subTables.length > 0 && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    选择数据表
                    {selectedSubTable && <span className="ml-2 text-indigo-600">✓ {subTables.find(t => t.table_id === selectedSubTable)?.name}</span>}
                  </label>
                  {subTables.length > 5 && (
                    <div className="relative mb-2">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" placeholder="搜索数据表..." className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" value={subTableSearch} onChange={(e) => setSubTableSearch(e.target.value)} />
                    </div>
                  )}
                  <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                    {subTables.filter(t => !subTableSearch || t.name.toLowerCase().includes(subTableSearch.toLowerCase())).map((t) => (
                      <div key={t.table_id} onClick={() => setSelectedSubTable(t.table_id)} className={`px-3 py-2 text-sm cursor-pointer transition-colors ${selectedSubTable === t.table_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}>{t.name}</div>
                    ))}
                  </div>
                </div>
              )}

              {selectedItem && selectedType === 'spreadsheet' && sheets.length > 0 && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    选择工作表
                    {selectedSheet && <span className="ml-2 text-indigo-600">✓ {sheets.find(s => s.sheet_id === selectedSheet)?.title}</span>}
                  </label>
                  <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                    {sheets.map((s) => (
                      <div key={s.sheet_id} onClick={() => setSelectedSheet(s.sheet_id)} className={`px-3 py-2 text-sm cursor-pointer transition-colors ${selectedSheet === s.sheet_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}>{s.title}</div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 兜底：粘贴链接 */}
          <div className="border-t border-gray-100 pt-3">
            <button
              onClick={() => setShowPasteUrl(!showPasteUrl)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600"
            >
              <ChevronDown size={14} className={`transition-transform ${showPasteUrl ? 'rotate-180' : ''}`} />
              在列表中找不到？粘贴飞书链接
            </button>
            {showPasteUrl && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://xxx.feishu.cn/wiki/... 或 /base/... 或 /sheets/..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={pasteUrl}
                    onChange={(e) => setPasteUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleParseUrl() }}
                  />
                  <button onClick={handleParseUrl} disabled={urlParsing} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap">
                    {urlParsing ? '解析中...' : '解析'}
                  </button>
                </div>
                {urlParsed && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${urlParsed.source_type === 'bitable' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                        {urlParsed.source_type === 'bitable' ? '多维表格' : '飞书表格'}
                      </span>
                    </div>
                    {urlParsed.source_type === 'bitable' && urlParsed.tables && (
                      <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {urlParsed.tables.map((t: any) => (
                          <div key={t.table_id} onClick={() => setUrlSelectedTable(t.table_id)} className={`px-3 py-2 text-sm cursor-pointer ${urlSelectedTable === t.table_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50'}`}>{t.name}</div>
                        ))}
                      </div>
                    )}
                    {urlParsed.source_type === 'spreadsheet' && urlParsed.sheets && (
                      <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {urlParsed.sheets.map((s: any) => (
                          <div key={s.sheet_id} onClick={() => setUrlSelectedSheet(s.sheet_id)} className={`px-3 py-2 text-sm cursor-pointer ${urlSelectedSheet === s.sheet_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50'}`}>{s.title}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">取消</button>
          <button
            onClick={handleImport}
            disabled={importing}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {importing && <RefreshCw size={14} className="animate-spin" />}
            {importing ? '导入中...' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
