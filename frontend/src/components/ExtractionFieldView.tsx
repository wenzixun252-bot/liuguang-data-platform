import { useEffect, useState } from 'react'
import { X, Search, FileText, MessageSquare, ChevronLeft, ChevronRight, Loader2, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api, { getExtractionRuleData } from '../lib/api'
import toast from 'react-hot-toast'

interface FieldDef {
  key: string
  label: string
  description: string
}

interface DataItem {
  source_type: string
  source_id: number
  source_title: string
  key_info: Record<string, any>
}

interface RuleInfo {
  id: number
  name: string
  fields: FieldDef[]
}

export default function ExtractionFieldView({
  ruleId,
  onClose,
}: {
  ruleId: number
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [rule, setRule] = useState<RuleInfo | null>(null)
  const [items, setItems] = useState<DataItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const pageSize = 50

  useEffect(() => {
    setLoading(true)
    getExtractionRuleData(ruleId, { search, page, page_size: pageSize })
      .then((data: any) => {
        setRule(data.rule)
        setItems(data.items || [])
        setTotal(data.total || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ruleId, search, page])

  const totalPages = Math.ceil(total / pageSize)
  const fields: FieldDef[] = rule?.fields || []

  const handleSearch = () => {
    setPage(1)
    setSearch(searchInput)
  }

  const handleExport = async () => {
    try {
      const params: Record<string, string> = {}
      if (search) params.search = search
      const resp = await api.get(`/extraction-rules/${ruleId}/export`, {
        params,
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([resp.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${rule?.name || '提取数据'}_提取数据.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('导出成功')
    } catch {
      toast.error('导出失败')
    }
  }

  const navigateToSource = (item: DataItem) => {
    onClose()
    if (item.source_type === 'document') {
      navigate(`/documents?highlight=${item.source_id}`)
    } else {
      navigate(`/communications?highlight=${item.source_id}`)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-5xl bg-white h-full flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800">
              {rule?.name || '加载中...'} — 字段视图
            </h2>
            <span className="text-xs text-gray-400">{total} 条数据</span>
          </div>
          <button
            onClick={handleExport}
            disabled={total === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-40"
            title="导出为 Excel"
          >
            <Download size={14} />
            导出
          </button>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="在提取字段值中搜索..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              搜索
            </button>
          </div>
        </div>

        {/* 表格区域 */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <FileText size={32} className="mb-2 opacity-50" />
              <p className="text-sm">暂无匹配的提取数据</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-violet-50">
                  <th className="text-left px-4 py-2.5 text-violet-700 font-medium whitespace-nowrap border-b border-violet-100">
                    来源
                  </th>
                  {fields.map((f) => (
                    <th
                      key={f.key}
                      className="text-left px-4 py-2.5 text-violet-700 font-medium whitespace-nowrap border-b border-violet-100"
                      title={f.description}
                    >
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr
                    key={`${item.source_type}-${item.source_id}`}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                    }`}
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <button
                        onClick={() => navigateToSource(item)}
                        className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline max-w-[200px]"
                        title={item.source_title}
                      >
                        {item.source_type === 'document' ? (
                          <FileText size={13} className="shrink-0 text-indigo-400" />
                        ) : (
                          <MessageSquare size={13} className="shrink-0 text-emerald-400" />
                        )}
                        <span className="truncate text-xs">{item.source_title || '无标题'}</span>
                      </button>
                    </td>
                    {fields.map((f) => {
                      const val = item.key_info[f.label] ?? item.key_info[f.key]
                      return (
                        <td key={f.key} className="px-4 py-2.5 text-gray-700 max-w-[250px]">
                          {val != null && val !== '' ? (
                            <span className="line-clamp-2 text-xs" title={String(val)}>
                              {String(val)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between shrink-0">
            <span className="text-xs text-gray-500">
              共 {total} 条，第 {page}/{totalPages} 页
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
