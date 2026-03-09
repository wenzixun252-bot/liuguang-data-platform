import { useState, useEffect, useRef } from 'react'
import {
  Database,
  ChevronRight,
  ChevronDown,
  Loader2,
  FileText,
  MessageSquare,
  Search,
  X,
  Check,
} from 'lucide-react'
import api from '../lib/api'

export interface DataSelection {
  mode: 'all' | 'by_type' | 'by_item'
  source_tables?: string[]
  source_ids?: [string, number][]
  label: string
}

interface DataItem {
  id: number
  title: string
}

const CATEGORIES = [
  { key: 'document', label: '文档数据', icon: FileText, endpoint: '/documents/list' },
  { key: 'communication', label: '沟通记录', icon: MessageSquare, endpoint: '/communications/list' },
] as const

interface CategoryData {
  items: DataItem[]
  loaded: boolean
  loading: boolean
  total: number
}

interface Props {
  open: boolean
  selection: DataSelection
  onClose: () => void
  onApply: (selection: DataSelection) => void
}

export default function DataPicker({ open, selection, onClose, onApply }: Props) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  const [catData, setCatData] = useState<Record<string, CategoryData>>({})
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(selection.source_tables || [])
  )
  const [selectedItems, setSelectedItems] = useState<Map<string, Set<number>>>(() => {
    const map = new Map<string, Set<number>>()
    for (const [table, id] of selection.source_ids || []) {
      if (!map.has(table)) map.set(table, new Set())
      map.get(table)!.add(id)
    }
    return map
  })
  const [searchQuery, setSearchQuery] = useState('')
  const overlayRef = useRef<HTMLDivElement>(null)

  // 重置时同步外部状态
  useEffect(() => {
    if (open) {
      setSelectedTypes(new Set(selection.source_tables || []))
      const map = new Map<string, Set<number>>()
      for (const [table, id] of selection.source_ids || []) {
        if (!map.has(table)) map.set(table, new Set())
        map.get(table)!.add(id)
      }
      setSelectedItems(map)
    }
  }, [open, selection])

  if (!open) return null

  const loadCategory = async (key: string, search?: string) => {
    const cat = CATEGORIES.find((c) => c.key === key)!
    setCatData((prev) => ({
      ...prev,
      [key]: { ...prev[key], loading: true, items: prev[key]?.items || [], loaded: prev[key]?.loaded || false, total: prev[key]?.total || 0 },
    }))
    try {
      const params: Record<string, unknown> = { page_size: 50 }
      if (search) params.search = search
      const res = await api.get(cat.endpoint, { params })
      const items: DataItem[] = (res.data.items || []).map((r: any) => ({
        id: r.id,
        title: r.title || r.content_text?.slice(0, 80) || `#${r.id}`,
      }))
      setCatData((prev) => ({
        ...prev,
        [key]: { items, loaded: true, loading: false, total: res.data.total || items.length },
      }))
    } catch {
      setCatData((prev) => ({
        ...prev,
        [key]: { items: [], loaded: true, loading: false, total: 0 },
      }))
    }
  }

  const handleExpandCategory = (key: string) => {
    if (expandedCat === key) {
      setExpandedCat(null)
      return
    }
    setExpandedCat(key)
    setSearchQuery('')
    if (!catData[key]?.loaded) {
      loadCategory(key)
    }
  }

  const handleSearch = (key: string) => {
    loadCategory(key, searchQuery)
  }

  const toggleType = (key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    // 选了整个类型就清除该类型下的具体选择
    setSelectedItems((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }

  const toggleItem = (catKey: string, itemId: number) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(catKey) || [])
      if (set.has(itemId)) set.delete(itemId)
      else set.add(itemId)
      if (set.size === 0) next.delete(catKey)
      else next.set(catKey, set)
      return next
    })
    // 选了具体条目就取消该类型的整体选择
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      next.delete(catKey)
      return next
    })
  }

  const getItemCount = (catKey: string): number => {
    return selectedItems.get(catKey)?.size || 0
  }

  const handleApply = () => {
    // 收集具体条目
    const allSourceIds: [string, number][] = []
    for (const [table, ids] of selectedItems) {
      for (const id of ids) {
        allSourceIds.push([table, id])
      }
    }

    if (allSourceIds.length > 0) {
      // 合并：整类型 + 具体条目
      const typeTables = [...selectedTypes]
      if (typeTables.length > 0 && allSourceIds.length > 0) {
        // 如果同时有类型选择和条目选择，优先条目
        onApply({
          mode: 'by_item',
          source_ids: allSourceIds,
          source_tables: typeTables.length > 0 ? typeTables : undefined,
          label: `${allSourceIds.length} 条数据` + (typeTables.length > 0 ? ` + ${typeTables.length} 类` : ''),
        })
      } else {
        onApply({
          mode: 'by_item',
          source_ids: allSourceIds,
          label: `${allSourceIds.length} 条数据`,
        })
      }
    } else if (selectedTypes.size > 0) {
      const tables = [...selectedTypes]
      const label = tables
        .map((t) => CATEGORIES.find((c) => c.key === t)?.label || t)
        .join(', ')
      onApply({ mode: 'by_type', source_tables: tables, label })
    } else {
      onApply({ mode: 'all', label: '全部' })
    }
    onClose()
  }

  const handleReset = () => {
    setSelectedTypes(new Set())
    setSelectedItems(new Map())
    onApply({ mode: 'all', label: '全部' })
    onClose()
  }

  const totalSelected = [...selectedItems.values()].reduce((s, set) => s + set.size, 0) + selectedTypes.size

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/20"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="absolute bg-white rounded-xl shadow-2xl border border-gray-200 w-[420px] max-h-[520px] flex flex-col"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-indigo-500" />
            <span className="text-sm font-medium text-gray-800">关联数据</span>
            {totalSelected > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded-full">
                已选 {totalSelected}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 数据分类列表 */}
        <div className="flex-1 overflow-y-auto">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const isExpanded = expandedCat === cat.key
            const data = catData[cat.key]
            const isTypeSelected = selectedTypes.has(cat.key)
            const itemCount = getItemCount(cat.key)
            const hasSelection = isTypeSelected || itemCount > 0

            return (
              <div key={cat.key} className="border-b border-gray-100 last:border-0">
                {/* 分类行 */}
                <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                  {/* 展开箭头 + 分类名 */}
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0"
                    onClick={() => handleExpandCategory(cat.key)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-400 shrink-0" />
                    )}
                    <Icon size={15} className={hasSelection ? 'text-indigo-500 shrink-0' : 'text-gray-400 shrink-0'} />
                    <span className={`text-sm ${hasSelection ? 'text-indigo-600 font-medium' : 'text-gray-700'}`}>
                      {cat.label}
                    </span>
                    {itemCount > 0 && (
                      <span className="text-xs text-indigo-500">({itemCount}条)</span>
                    )}
                  </button>
                  {/* 整类勾选 */}
                  <button
                    onClick={() => toggleType(cat.key)}
                    className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                      isTypeSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-gray-300 hover:border-indigo-400'
                    }`}
                    title={`选中全部${cat.label}`}
                  >
                    {isTypeSelected && <Check size={12} />}
                  </button>
                </div>

                {/* 展开内容 */}
                {isExpanded && (
                  <div className="bg-gray-50 border-t border-gray-100">
                    {/* 搜索栏 */}
                    <div className="flex gap-2 px-4 py-2">
                      <div className="flex-1 relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg bg-white focus:outline-none focus:border-indigo-400"
                          placeholder={`搜索${cat.label}...`}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearch(cat.key)}
                        />
                      </div>
                      <button
                        onClick={() => handleSearch(cat.key)}
                        className="px-2.5 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                      >
                        搜索
                      </button>
                    </div>

                    {/* 条目列表 */}
                    <div className="max-h-48 overflow-y-auto">
                      {data?.loading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 size={16} className="animate-spin text-gray-400" />
                        </div>
                      ) : !data?.items?.length ? (
                        <p className="text-xs text-gray-400 text-center py-4">暂无数据</p>
                      ) : (
                        data.items.map((item) => {
                          const isChecked = selectedItems.get(cat.key)?.has(item.id) || false
                          return (
                            <label
                              key={item.id}
                              className={`flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-white transition-colors ${
                                isChecked ? 'bg-indigo-50/50' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleItem(cat.key, item.id)}
                                className="w-3.5 h-3.5 text-indigo-600 rounded shrink-0"
                              />
                              <span className="text-xs text-gray-600 truncate">{item.title}</span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={handleReset}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            重置（使用全部）
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
