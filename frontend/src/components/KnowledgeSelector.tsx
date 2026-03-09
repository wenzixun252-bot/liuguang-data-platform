import { useState, useEffect } from 'react'
import { Database, ChevronRight, ChevronDown, Loader2, FileText, MessageSquare } from 'lucide-react'
import api from '../lib/api'

export interface KnowledgeFilter {
  mode: 'all' | 'by_type' | 'by_item'
  source_tables?: string[]
  source_ids?: [string, number][]
  label: string
}

interface DataItem {
  id: number
  title: string
}

interface CategoryState {
  expanded: boolean
  loading: boolean
  items: DataItem[]
  loaded: boolean
  selected: Set<number>
}

const CATEGORIES = [
  { key: 'document', label: '文档数据', icon: FileText, endpoint: '/documents' },
  { key: 'communication', label: '沟通记录', icon: MessageSquare, endpoint: '/communications' },
] as const

interface Props {
  filter: KnowledgeFilter
  onFilterChange: (filter: KnowledgeFilter) => void
}

export default function KnowledgeSelector({ filter, onFilterChange }: Props) {
  const [mode, setMode] = useState<'all' | 'specific'>(
    filter.mode === 'all' ? 'all' : 'specific'
  )
  const [categories, setCategories] = useState<Record<string, CategoryState>>(() => {
    const init: Record<string, CategoryState> = {}
    for (const cat of CATEGORIES) {
      // 恢复之前选中的状态
      const selectedIds = (filter.source_ids || [])
        .filter(([t]) => t === cat.key)
        .map(([, id]) => id)
      init[cat.key] = {
        expanded: false,
        loading: false,
        items: [],
        loaded: false,
        selected: new Set(selectedIds),
      }
    }
    return init
  })

  // 根据 filter.source_tables 初始化选中的类型
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(() => {
    if (filter.mode === 'by_type' && filter.source_tables) {
      return new Set(filter.source_tables)
    }
    return new Set()
  })

  // 点击展开分类时加载数据
  const toggleExpand = async (key: string) => {
    const cat = categories[key]
    const newExpanded = !cat.expanded

    setCategories((prev) => ({
      ...prev,
      [key]: { ...prev[key], expanded: newExpanded },
    }))

    // 第一次展开时加载数据
    if (newExpanded && !cat.loaded) {
      setCategories((prev) => ({
        ...prev,
        [key]: { ...prev[key], loading: true },
      }))
      try {
        const catDef = CATEGORIES.find((c) => c.key === key)!
        const res = await api.get(catDef.endpoint, { params: { page_size: 100 } })
        const items: DataItem[] = (res.data.items || res.data || []).map((r: any) => ({
          id: r.id,
          title: r.title || r.content_text?.slice(0, 60) || `#${r.id}`,
        }))
        setCategories((prev) => ({
          ...prev,
          [key]: { ...prev[key], items, loaded: true, loading: false },
        }))
      } catch {
        setCategories((prev) => ({
          ...prev,
          [key]: { ...prev[key], loading: false, loaded: true, items: [] },
        }))
      }
    }
  }

  // 切换选中某条数据
  const toggleItem = (catKey: string, itemId: number) => {
    setCategories((prev) => {
      const cat = prev[catKey]
      const newSelected = new Set(cat.selected)
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId)
      } else {
        newSelected.add(itemId)
      }
      return { ...prev, [catKey]: { ...cat, selected: newSelected } }
    })
  }

  // 切换选中整个分类
  const toggleType = (key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 全选/取消全选某个分类下的所有条目
  const toggleAllInCategory = (catKey: string) => {
    setCategories((prev) => {
      const cat = prev[catKey]
      const allSelected = cat.items.length > 0 && cat.items.every((i) => cat.selected.has(i.id))
      const newSelected = allSelected ? new Set<number>() : new Set(cat.items.map((i) => i.id))
      return { ...prev, [catKey]: { ...cat, selected: newSelected } }
    })
  }

  // 同步 filter 到父组件
  useEffect(() => {
    if (mode === 'all') {
      onFilterChange({ mode: 'all', label: '全部' })
      return
    }

    // 收集所有选中的具体条目
    const allSourceIds: [string, number][] = []
    const typesWithSelection: string[] = []

    for (const cat of CATEGORIES) {
      const catState = categories[cat.key]
      if (selectedTypes.has(cat.key)) {
        typesWithSelection.push(cat.key)
      }
      for (const id of catState.selected) {
        allSourceIds.push([cat.key, id])
      }
    }

    if (allSourceIds.length > 0) {
      onFilterChange({
        mode: 'by_item',
        source_ids: allSourceIds,
        label: `${allSourceIds.length} 条数据`,
      })
    } else if (typesWithSelection.length > 0) {
      const label = typesWithSelection
        .map((t) => CATEGORIES.find((c) => c.key === t)?.label || t)
        .join(', ')
      onFilterChange({
        mode: 'by_type',
        source_tables: typesWithSelection,
        label,
      })
    } else {
      onFilterChange({ mode: 'all', label: '全部' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedTypes, categories])

  return (
    <div className="w-56 border-l border-gray-200 bg-gray-50 flex flex-col h-full">
      {/* 头部 */}
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center gap-1.5 mb-2">
          <Database size={14} className="text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">关联数据</span>
        </div>
        {/* 模式切换 */}
        <div className="flex bg-gray-100 rounded-md p-0.5">
          <button
            className={`flex-1 text-xs py-1 rounded transition-colors ${
              mode === 'all'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setMode('all')}
          >
            全部数据
          </button>
          <button
            className={`flex-1 text-xs py-1 rounded transition-colors ${
              mode === 'specific'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setMode('specific')}
          >
            指定数据
          </button>
        </div>
      </div>

      {/* 数据分类列表 */}
      {mode === 'specific' && (
        <div className="flex-1 overflow-y-auto">
          {CATEGORIES.map((cat) => {
            const catState = categories[cat.key]
            const Icon = cat.icon
            const hasSelection = selectedTypes.has(cat.key) || catState.selected.size > 0

            return (
              <div key={cat.key} className="border-b border-gray-100">
                {/* 分类头 */}
                <div
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 transition-colors ${
                    hasSelection ? 'bg-indigo-50' : ''
                  }`}
                  onClick={() => toggleExpand(cat.key)}
                >
                  {catState.expanded ? (
                    <ChevronDown size={12} className="text-gray-400" />
                  ) : (
                    <ChevronRight size={12} className="text-gray-400" />
                  )}
                  <Icon size={14} className={hasSelection ? 'text-indigo-500' : 'text-gray-400'} />
                  <span className={`text-xs flex-1 ${hasSelection ? 'text-indigo-600 font-medium' : 'text-gray-600'}`}>
                    {cat.label}
                  </span>
                  {/* 整个分类勾选 */}
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(cat.key)}
                    onChange={(e) => {
                      e.stopPropagation()
                      toggleType(cat.key)
                    }}
                    className="w-3.5 h-3.5 text-indigo-600 rounded"
                    title="选中整个分类"
                  />
                </div>

                {/* 展开的条目列表 */}
                {catState.expanded && (
                  <div className="bg-white">
                    {catState.loading ? (
                      <div className="flex justify-center py-3">
                        <Loader2 size={14} className="animate-spin text-gray-400" />
                      </div>
                    ) : catState.items.length === 0 ? (
                      <p className="text-xs text-gray-400 px-7 py-2">暂无数据</p>
                    ) : (
                      <>
                        {/* 全选按钮 */}
                        <div className="px-3 py-1 border-b border-gray-50">
                          <button
                            className="text-xs text-indigo-500 hover:text-indigo-700"
                            onClick={() => toggleAllInCategory(cat.key)}
                          >
                            {catState.items.every((i) => catState.selected.has(i.id))
                              ? '取消全选'
                              : '全选'}
                          </button>
                        </div>
                        <div className="max-h-40 overflow-y-auto">
                          {catState.items.map((item) => (
                            <label
                              key={item.id}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={catState.selected.has(item.id)}
                                onChange={() => toggleItem(cat.key, item.id)}
                                className="w-3 h-3 text-indigo-600 rounded"
                              />
                              <span className="text-xs text-gray-600 truncate">{item.title}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {mode === 'all' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-400">将搜索全部数据</p>
        </div>
      )}
    </div>
  )
}
