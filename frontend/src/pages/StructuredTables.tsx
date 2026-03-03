import { useEffect, useState, useCallback } from 'react'
import {
  Search, ChevronLeft, ChevronRight, X, Trash2, RefreshCw,
  ExternalLink, Upload, Table2, Plus, FileSpreadsheet,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

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
  const [showImport, setShowImport] = useState(false)

  const pageSize = 20

  /* ── 加载表格列表 ─────────────────────────────── */

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (sourceFilter) params.source_type = sourceFilter

    api.get('/structured-tables', { params })
      .then((res) => {
        setItems(res.data.items)
        setTotal(res.data.total)
      })
      .catch(() => toast.error('加载表格列表失败'))
      .finally(() => setLoading(false))
  }, [page, search, sourceFilter, refreshKey])

  useEffect(() => { setSelectedIds(new Set()) }, [page, search, sourceFilter])

  const totalPages = Math.ceil(total / pageSize)
  const currentIds = items.map((i) => i.id)
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id))

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
        <h1 className="text-2xl font-bold text-gray-800">数据表</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
          >
            <Plus size={16} />
            导入表格
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

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
          <span className="text-sm text-indigo-700 font-medium">已选择 {selectedIds.size} 项</span>
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
          <div className="p-12 text-center text-gray-400">暂无数据表，点击"导入表格"开始</div>
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

      {/* 导入弹窗 */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); setRefreshKey((k) => k + 1) }}
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

/* ── 导入弹窗 ─────────────────────────────────── */

function ImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [tab, setTab] = useState<'url' | 'bitable' | 'spreadsheet' | 'local'>('url')
  const [importing, setImporting] = useState(false)

  // 粘贴链接
  const [pasteUrl, setPasteUrl] = useState('')
  const [urlParsed, setUrlParsed] = useState<{
    source_type: string; app_token: string; table_id?: string | null;
    tables?: { table_id: string; name: string }[];
    sheets?: { sheet_id: string; title: string }[];
  } | null>(null)
  const [urlParsing, setUrlParsing] = useState(false)
  const [urlSelectedTable, setUrlSelectedTable] = useState('')
  const [urlSelectedSheet, setUrlSelectedSheet] = useState('')

  // 飞书多维表格（列表模式）
  const [bitables, setBitables] = useState<{ token: string; name: string }[]>([])
  const [selectedBitable, setSelectedBitable] = useState('')
  const [bitableSearch, setBitableSearch] = useState('')
  const [bitableTables, setBitableTables] = useState<{ table_id: string; name: string }[]>([])
  const [selectedBitableTable, setSelectedBitableTable] = useState('')
  const [bitableTableSearch, setBitableTableSearch] = useState('')
  const [loadingBitables, setLoadingBitables] = useState(false)

  // 飞书表格（列表模式）
  const [spreadsheets, setSpreadsheets] = useState<{ token: string; name: string }[]>([])
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState('')
  const [spreadsheetSearch, setSpreadsheetSearch] = useState('')
  const [sheetList, setSheetList] = useState<{ sheet_id: string; title: string }[]>([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [loadingSheets, setLoadingSheets] = useState(false)

  // 本地上传
  const [file, setFile] = useState<File | null>(null)

  /* 解析粘贴的链接 */
  const handleParseUrl = async () => {
    if (!pasteUrl.trim()) { toast.error('请粘贴飞书链接'); return }
    setUrlParsing(true)
    setUrlParsed(null)
    setUrlSelectedTable('')
    setUrlSelectedSheet('')
    try {
      const res = await api.post('/structured-tables/parse-url', { url: pasteUrl })
      setUrlParsed(res.data)
      // 如果链接里已自带 table_id，自动选上
      if (res.data.table_id) setUrlSelectedTable(res.data.table_id)
      // 如果只有一个子表/工作表，自动选上
      if (res.data.tables?.length === 1) setUrlSelectedTable(res.data.tables[0].table_id)
      if (res.data.sheets?.length === 1) setUrlSelectedSheet(res.data.sheets[0].sheet_id)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '链接解析失败')
    } finally {
      setUrlParsing(false)
    }
  }

  /* 加载飞书多维表格列表 */
  const loadBitables = async () => {
    setLoadingBitables(true)
    try {
      const res = await api.get('/import/feishu-discover')
      const items = (res.data || []).map((f: any) => ({ token: f.app_token, name: f.app_name }))
      setBitables(items)
    } catch { toast.error('获取多维表格列表失败') }
    finally { setLoadingBitables(false) }
  }

  const loadBitableTables = async (appToken: string) => {
    try {
      const res = await api.get(`/import/feishu-discover/${appToken}/tables`)
      setBitableTables((res.data || []).map((t: any) => ({ table_id: t.table_id, name: t.name })))
    } catch { toast.error('获取表列表失败') }
  }

  /* 加载飞书表格列表 */
  const loadSpreadsheets = async () => {
    setLoadingSheets(true)
    try {
      const res = await api.get('/structured-tables/discover-spreadsheets')
      setSpreadsheets(res.data.files || [])
    } catch { toast.error('获取飞书表格列表失败') }
    finally { setLoadingSheets(false) }
  }

  const loadSheets = async (token: string) => {
    try {
      const res = await api.get(`/structured-tables/discover-sheets/${token}`)
      setSheetList(res.data.sheets || [])
    } catch { toast.error('获取工作表列表失败') }
  }

  useEffect(() => {
    if (tab === 'bitable' && bitables.length === 0) loadBitables()
    if (tab === 'spreadsheet' && spreadsheets.length === 0) loadSpreadsheets()
  }, [tab])

  /* 导入 */
  const handleImport = async () => {
    setImporting(true)
    try {
      if (tab === 'url') {
        if (!urlParsed) { toast.error('请先粘贴链接并解析'); return }
        if (urlParsed.source_type === 'bitable') {
          if (!urlSelectedTable) { toast.error('请选择要导入的数据表'); return }
          await api.post('/structured-tables/import/bitable', { app_token: urlParsed.app_token, table_id: urlSelectedTable })
        } else {
          if (!urlSelectedSheet) { toast.error('请选择要导入的工作表'); return }
          await api.post('/structured-tables/import/spreadsheet', { spreadsheet_token: urlParsed.app_token, sheet_id: urlSelectedSheet })
        }
      } else if (tab === 'bitable') {
        if (!selectedBitable || !selectedBitableTable) { toast.error('请选择多维表格和数据表'); return }
        await api.post('/structured-tables/import/bitable', { app_token: selectedBitable, table_id: selectedBitableTable })
      } else if (tab === 'spreadsheet') {
        if (!selectedSpreadsheet || !selectedSheet) { toast.error('请选择飞书表格和工作表'); return }
        await api.post('/structured-tables/import/spreadsheet', { spreadsheet_token: selectedSpreadsheet, sheet_id: selectedSheet })
      } else {
        if (!file) { toast.error('请选择文件'); return }
        const formData = new FormData()
        formData.append('file', file)
        await api.post('/structured-tables/import/upload', formData)
      }
      toast.success('导入成功')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const TABS = [
    { key: 'url' as const, label: '粘贴链接', icon: <ExternalLink size={14} /> },
    { key: 'bitable' as const, label: '多维表格', icon: <Table2 size={14} /> },
    { key: 'spreadsheet' as const, label: '飞书表格', icon: <FileSpreadsheet size={14} /> },
    { key: 'local' as const, label: '本地上传', icon: <Upload size={14} /> },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">导入表格</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>

        {/* Tab */}
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4 min-h-[200px]">

          {/* 粘贴链接 Tab */}
          {tab === 'url' && (
            <>
              <div>
                <label className="block text-sm text-gray-600 mb-1">粘贴飞书表格链接</label>
                <p className="text-xs text-gray-400 mb-2">支持多维表格、飞书表格、知识空间 Wiki 内嵌表格的链接</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://xxx.feishu.cn/wiki/... 或 /base/... 或 /sheets/..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={pasteUrl}
                    onChange={(e) => setPasteUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleParseUrl() }}
                  />
                  <button
                    onClick={handleParseUrl}
                    disabled={urlParsing}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
                  >
                    {urlParsing ? '解析中...' : '解析'}
                  </button>
                </div>
              </div>

              {urlParsed && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${urlParsed.source_type === 'bitable' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                      {urlParsed.source_type === 'bitable' ? '多维表格' : '飞书表格'}
                    </span>
                    <span className="text-xs text-gray-400">token: {urlParsed.app_token.slice(0, 12)}...</span>
                  </div>

                  {/* 多维表格 → 选择数据表 */}
                  {urlParsed.source_type === 'bitable' && urlParsed.tables && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">
                        选择数据表
                        {urlSelectedTable && <span className="ml-2 text-indigo-600">✓ {urlParsed.tables.find((t: any) => t.table_id === urlSelectedTable)?.name}</span>}
                      </label>
                      <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {urlParsed.tables.map((t: any) => (
                          <div
                            key={t.table_id}
                            onClick={() => setUrlSelectedTable(t.table_id)}
                            className={`px-3 py-2 text-sm cursor-pointer transition-colors ${urlSelectedTable === t.table_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            {t.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 飞书表格 → 选择工作表 */}
                  {urlParsed.source_type === 'spreadsheet' && urlParsed.sheets && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">
                        选择工作表
                        {urlSelectedSheet && <span className="ml-2 text-indigo-600">✓ {urlParsed.sheets.find((s: any) => s.sheet_id === urlSelectedSheet)?.title}</span>}
                      </label>
                      <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {urlParsed.sheets.map((s: any) => (
                          <div
                            key={s.sheet_id}
                            onClick={() => setUrlSelectedSheet(s.sheet_id)}
                            className={`px-3 py-2 text-sm cursor-pointer transition-colors ${urlSelectedSheet === s.sheet_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            {s.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 飞书多维表格 Tab */}
          {tab === 'bitable' && (
            <>
              {loadingBitables ? <div className="text-center text-gray-400 py-8">加载中...</div> : (
                <>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      选择多维表格
                      {selectedBitable && <span className="ml-2 text-indigo-600">✓ {bitables.find(b => b.token === selectedBitable)?.name}</span>}
                    </label>
                    <p className="text-xs text-gray-400 mb-2">仅显示云空间中的表格，知识空间的请用"粘贴链接"导入</p>
                    <div className="relative mb-2">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="搜索多维表格名称..."
                        className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        value={bitableSearch}
                        onChange={(e) => setBitableSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                      {bitables.filter(b => !bitableSearch || b.name.toLowerCase().includes(bitableSearch.toLowerCase())).map((b) => (
                        <div
                          key={b.token}
                          onClick={() => { setSelectedBitable(b.token); setSelectedBitableTable(''); setBitableTableSearch(''); loadBitableTables(b.token) }}
                          className={`px-3 py-2 text-sm cursor-pointer transition-colors ${selectedBitable === b.token ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                        >
                          {b.name}
                        </div>
                      ))}
                      {bitables.filter(b => !bitableSearch || b.name.toLowerCase().includes(bitableSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-4 text-sm text-gray-400 text-center">无匹配结果</div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">共 {bitables.length} 个多维表格</p>
                  </div>
                  {selectedBitable && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">
                        选择数据表
                        {selectedBitableTable && <span className="ml-2 text-indigo-600">✓ {bitableTables.find(t => t.table_id === selectedBitableTable)?.name}</span>}
                      </label>
                      {bitableTables.length > 5 && (
                        <div className="relative mb-2">
                          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            placeholder="搜索数据表名称..."
                            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            value={bitableTableSearch}
                            onChange={(e) => setBitableTableSearch(e.target.value)}
                          />
                        </div>
                      )}
                      <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {bitableTables.filter(t => !bitableTableSearch || t.name.toLowerCase().includes(bitableTableSearch.toLowerCase())).map((t) => (
                          <div
                            key={t.table_id}
                            onClick={() => setSelectedBitableTable(t.table_id)}
                            className={`px-3 py-2 text-sm cursor-pointer transition-colors ${selectedBitableTable === t.table_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            {t.name}
                          </div>
                        ))}
                        {bitableTables.filter(t => !bitableTableSearch || t.name.toLowerCase().includes(bitableTableSearch.toLowerCase())).length === 0 && (
                          <div className="px-3 py-4 text-sm text-gray-400 text-center">无匹配结果</div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* 飞书表格 Tab */}
          {tab === 'spreadsheet' && (
            <>
              {loadingSheets ? <div className="text-center text-gray-400 py-8">加载中...</div> : (
                <>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      选择飞书表格
                      {selectedSpreadsheet && <span className="ml-2 text-indigo-600">✓ {spreadsheets.find(s => s.token === selectedSpreadsheet)?.name}</span>}
                    </label>
                    <p className="text-xs text-gray-400 mb-2">仅显示云空间中的表格，知识空间的请用"粘贴链接"导入</p>
                    <div className="relative mb-2">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="搜索飞书表格名称..."
                        className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        value={spreadsheetSearch}
                        onChange={(e) => setSpreadsheetSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                      {spreadsheets.filter(s => !spreadsheetSearch || s.name.toLowerCase().includes(spreadsheetSearch.toLowerCase())).map((s) => (
                        <div
                          key={s.token}
                          onClick={() => { setSelectedSpreadsheet(s.token); setSelectedSheet(''); loadSheets(s.token) }}
                          className={`px-3 py-2 text-sm cursor-pointer transition-colors ${selectedSpreadsheet === s.token ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                        >
                          {s.name}
                        </div>
                      ))}
                      {spreadsheets.filter(s => !spreadsheetSearch || s.name.toLowerCase().includes(spreadsheetSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-4 text-sm text-gray-400 text-center">无匹配结果</div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">共 {spreadsheets.length} 个飞书表格</p>
                  </div>
                  {selectedSpreadsheet && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">
                        选择工作表
                        {selectedSheet && <span className="ml-2 text-indigo-600">✓ {sheetList.find(s => s.sheet_id === selectedSheet)?.title}</span>}
                      </label>
                      <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {sheetList.map((s) => (
                          <div
                            key={s.sheet_id}
                            onClick={() => setSelectedSheet(s.sheet_id)}
                            className={`px-3 py-2 text-sm cursor-pointer transition-colors ${selectedSheet === s.sheet_id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            {s.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* 本地上传 Tab */}
          {tab === 'local' && (
            <div>
              <label className="block text-sm text-gray-600 mb-2">选择文件 (.csv / .xlsx / .xls)</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              {file && <p className="mt-2 text-sm text-gray-500">已选择: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
            </div>
          )}
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
