import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { ChevronUp, ChevronDown, GripVertical, Eye, EyeOff, Save, LayoutGrid, Plus, Trash2, ArrowUpNarrowWide, ArrowDownNarrowWide, Lock, Unlock, RotateCcw, Columns3, AlignVerticalSpaceAround, ArrowUpDown, X } from 'lucide-react'
import { useTableViews } from './useTableViews'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DataTableColumn<T = any> {
  key: string
  label: string
  width?: number
  minWidth?: number
  defaultVisible?: boolean
  sortable?: boolean
  frozen?: boolean
  headerClassName?: string
  cellClassName?: string | ((item: T, ctx: CellContext) => string)
  cell: (item: T, ctx: CellContext) => ReactNode
  headerExtra?: ReactNode
}

export interface CellContext {
  search: string
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  rowKey: (item: T) => string | number
  loading?: boolean
  emptyContent?: ReactNode
  storageKey: string
  search?: string

  // Selection
  selectable?: boolean
  selectedIds?: Set<number>
  onSelectionChange?: (ids: Set<number>) => void

  // Row click
  onRowClick?: (item: T) => void
  activeRowId?: number | string | null

  // Display count (replaces pagination)
  total?: number
  displayCount?: number
  onDisplayCountChange?: (count: number) => void
  displayCountOptions?: number[]

  // Sort (external — if provided, sorting is controlled externally)
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  onSort?: (key: string, order: 'asc' | 'desc') => void

  // Row reordering (drag to reorder, persisted internally via localStorage)
  reorderable?: boolean
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyContent,
  storageKey,
  search = '',
  selectable = false,
  selectedIds,
  onSelectionChange,
  onRowClick,
  activeRowId,
  total = 0,
  displayCount,
  onDisplayCountChange,
  displayCountOptions = [20, 50, 100, 200],
  sortBy: externalSortBy,
  sortOrder: externalSortOrder,
  onSort,
  reorderable = false,
}: DataTableProps<T>) {
  const tableRef = useRef<HTMLDivElement>(null)
  const defaultKeys = useMemo(() => columns.map(c => c.key), [columns])

  // View management
  const { views, activeView, activeViewId, saveView, updateView, deleteView, switchView, saveDisplayCount, loadDefaultConfig, saveDefaultConfig, loadRowOrder, saveRowOrder, clearRowOrder, loadSort, saveSort } = useTableViews(storageKey, defaultKeys)

  // Column order (from view or saved default or column defaults)
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (activeView?.columnOrder) return activeView.columnOrder
    const saved = loadDefaultConfig()
    if (saved?.columnOrder) return saved.columnOrder
    return defaultKeys
  })

  // Column widths (from view or saved default or auto-fit by header)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (activeView?.columnWidths) return activeView.columnWidths
    const saved = loadDefaultConfig()
    if (saved?.columnWidths) return saved.columnWidths
    // Default: auto-fit based on header label width
    const defaults: Record<string, number> = {}
    columns.forEach(c => {
      let charWidth = 0
      for (const ch of c.label) {
        charWidth += ch.charCodeAt(0) > 127 ? 14 : 8
      }
      const headerFit = charWidth + 72
      // Use the larger of: header-fit width or column-defined width (content may need more space)
      defaults[c.key] = Math.max(c.minWidth || 60, c.width || 150, headerFit)
    })
    return defaults
  })

  // Hidden columns (from view or saved default or column defaults)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    if (activeView?.hiddenColumns) return new Set(activeView.hiddenColumns)
    const saved = loadDefaultConfig()
    if (saved?.hiddenColumns) return new Set(saved.hiddenColumns)
    return new Set()
  })

  // Frozen column count
  const [frozenCount, setFrozenCount] = useState(() => {
    if (activeView) return activeView.frozenCount
    const saved = loadDefaultConfig()
    if (saved?.frozenCount != null) return saved.frozenCount
    return 1
  })

  // Row height: 'compact' | 'default' | 'comfortable'
  type RowHeight = 'compact' | 'default' | 'comfortable'
  const rowHeightPyMap: Record<RowHeight, string> = { compact: 'py-1.5', default: 'py-2.5', comfortable: 'py-4' }
  const rowHeightLabels: Record<RowHeight, string> = { compact: '紧凑', default: '默认', comfortable: '宽松' }
  const [rowHeight, setRowHeight] = useState<RowHeight>(() => {
    try {
      const v = localStorage.getItem('table-rowHeight:' + storageKey)
      if (v === 'compact' || v === 'default' || v === 'comfortable') return v
    } catch { /* ignore */ }
    return 'default'
  })
  const rowPy = rowHeightPyMap[rowHeight]

  // Sync when view changes
  useEffect(() => {
    if (activeView) {
      setColumnOrder(activeView.columnOrder)
      setColumnWidths(activeView.columnWidths)
      setHiddenColumns(new Set(activeView.hiddenColumns))
      setFrozenCount(activeView.frozenCount)
    } else {
      // Switched back to default view — restore saved default config
      const saved = loadDefaultConfig()
      if (saved) {
        setColumnOrder(saved.columnOrder)
        setColumnWidths(saved.columnWidths)
        setHiddenColumns(new Set(saved.hiddenColumns))
        if (saved.frozenCount != null) setFrozenCount(saved.frozenCount)
      }
    }
  }, [activeViewId])

  // Auto-persist default view config when not using a named view
  useEffect(() => {
    if (activeViewId) return // named view handles its own persistence
    saveDefaultConfig({
      columnOrder,
      columnWidths,
      hiddenColumns: [...hiddenColumns],
      frozenCount,
    })
  }, [activeViewId, columnOrder, columnWidths, hiddenColumns, frozenCount, saveDefaultConfig])

  // Sync column order when columns definition changes (new columns added)
  useEffect(() => {
    setColumnOrder(prev => {
      const existing = new Set(prev)
      const updated = [...prev]
      for (const c of columns) {
        if (!existing.has(c.key)) updated.push(c.key)
      }
      return updated.filter(k => columns.some(c => c.key === k))
    })
  }, [columns])

  // Resolved visible columns in order
  const visibleColumns = useMemo(() => {
    return columnOrder
      .filter(k => !hiddenColumns.has(k))
      .map(k => columns.find(c => c.key === k)!)
      .filter(Boolean)
  }, [columnOrder, hiddenColumns, columns])

  // Column map for quick lookup
  const columnMap = useMemo(() => {
    const map: Record<string, DataTableColumn<T>> = {}
    columns.forEach(c => { map[c.key] = c })
    return map
  }, [columns])

  /* ---------- Auto-fit column widths to header ---------- */
  const autoFitColumns = useCallback(() => {
    const next: Record<string, number> = {}
    for (const col of visibleColumns) {
      // Estimate width from header label: ~14px per CJK char, ~8px per ASCII char, + 72px padding (grip icon + sort icon + padding)
      let charWidth = 0
      for (const ch of col.label) {
        charWidth += ch.charCodeAt(0) > 127 ? 14 : 8
      }
      const minW = col.minWidth || 60
      next[col.key] = Math.max(minW, charWidth + 72)
    }
    setColumnWidths(prev => ({ ...prev, ...next }))
  }, [visibleColumns])

  /* ---------- Column resizing ---------- */
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const handleResizeStart = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault()
    e.stopPropagation()
    const startWidth = columnWidths[key] || 150
    resizingRef.current = { key, startX: e.clientX, startWidth }

    const onMouseMove = (ev: MouseEvent) => {
      const ref = resizingRef.current
      if (!ref) return
      const diff = ev.clientX - ref.startX
      const minW = columnMap[key]?.minWidth || 60
      const newWidth = Math.max(minW, ref.startWidth + diff)
      setColumnWidths(prev => ({ ...prev, [ref.key]: newWidth }))
    }

    const onMouseUp = () => {
      resizingRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [columnWidths, columnMap])

  /* ---------- Column reordering ---------- */
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, key: string) => {
    setDragKey(key)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
    // Add drag ghost styling
    const el = e.currentTarget as HTMLElement
    setTimeout(() => el.style.opacity = '0.4', 0)
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    if (dragKey && dragOverKey && dragKey !== dragOverKey) {
      setColumnOrder(prev => {
        const next = [...prev]
        const fromIdx = next.indexOf(dragKey)
        const toIdx = next.indexOf(dragOverKey)
        if (fromIdx === -1 || toIdx === -1) return prev
        next.splice(fromIdx, 1)
        next.splice(toIdx, 0, dragKey)
        return next
      })
    }
    setDragKey(null)
    setDragOverKey(null)
  }, [dragKey, dragOverKey])

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverKey(key)
  }, [])

  /* ---------- Column visibility ---------- */
  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        // Don't hide all
        const visCount = columns.length - next.size
        if (visCount <= 1) return prev
        next.add(key)
      }
      return next
    })
  }, [columns])

  /* ---------- Selection ---------- */
  const currentIds = useMemo(() => data.map(item => rowKey(item) as number), [data, rowKey])
  const allSelected = currentIds.length > 0 && selectedIds ? currentIds.every(id => selectedIds.has(id)) : false

  const toggleSelectAll = useCallback(() => {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(currentIds))
    }
  }, [allSelected, currentIds, onSelectionChange])

  const toggleSelect = useCallback((id: number) => {
    if (!onSelectionChange || !selectedIds) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }, [selectedIds, onSelectionChange])

  /* ---------- Sorting ---------- */
  const [internalSortBy, setInternalSortBy] = useState<string | null>(() => {
    const saved = loadSort()
    return saved?.sortBy ?? null
  })
  const [internalSortOrder, setInternalSortOrder] = useState<'asc' | 'desc'>(() => {
    const saved = loadSort()
    return saved?.sortOrder ?? 'asc'
  })

  const sortBy = externalSortBy ?? internalSortBy
  const sortOrder = externalSortOrder ?? internalSortOrder

  const handleSort = useCallback((key: string) => {
    const col = columnMap[key]
    if (!col?.sortable) return
    const newOrder = sortBy === key ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc'
    if (onSort) {
      onSort(key, newOrder)
    } else {
      setInternalSortBy(key)
      setInternalSortOrder(newOrder)
      saveSort(key, newOrder)
    }
  }, [onSort, sortBy, sortOrder, columnMap, saveSort])

  // Client-side sorted data (only when sorting internally)
  const sortedData = useMemo(() => {
    if (onSort || !internalSortBy) return data
    const col = columnMap[internalSortBy]
    if (!col) return data
    const sorted = [...data]
    sorted.sort((a, b) => {
      const aKey = internalSortBy as keyof T
      const aVal = a[aKey]
      const bVal = b[aKey]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return internalSortOrder === 'asc' ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      const cmp = aStr.localeCompare(bStr, 'zh-CN')
      return internalSortOrder === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [data, internalSortBy, internalSortOrder, onSort, columnMap])

  const renderData = sortedData

  /* ---------- Row reordering ---------- */
  const canReorder = reorderable && !sortBy

  /* ---------- Frozen column positions ---------- */
  const frozenOffsets = useMemo(() => {
    const offsets: Record<string, number> = {}
    let acc = (canReorder ? 32 : 0) + (selectable ? 44 : 0) // drag handle + checkbox width
    for (let i = 0; i < Math.min(frozenCount, visibleColumns.length); i++) {
      const col = visibleColumns[i]
      offsets[col.key] = acc
      acc += columnWidths[col.key] || 150
    }
    return offsets
  }, [frozenCount, visibleColumns, columnWidths, selectable, canReorder])

  // Helper: is this column the last frozen one? (for shadow divider)
  const isLastFrozen = useCallback((idx: number) => frozenCount > 0 && idx === frozenCount - 1, [frozenCount])
  const lastFrozenShadow = '4px 0 8px -2px rgba(0,0,0,0.08)'
  const [rowDragIdx, setRowDragIdx] = useState<number | null>(null)
  const [rowDropIdx, setRowDropIdx] = useState<number | null>(null)
  const [customRowOrder, setCustomRowOrder] = useState<(string | number)[]>(() =>
    reorderable ? loadRowOrder() : []
  )

  // Apply custom row order to renderData when reordering is active
  const reorderedData = useMemo(() => {
    if (!canReorder || customRowOrder.length === 0) return renderData
    const orderMap = new Map<string | number, number>()
    customRowOrder.forEach((key, idx) => orderMap.set(key, idx))
    const sorted = [...renderData]
    sorted.sort((a, b) => {
      const aKey = rowKey(a)
      const bKey = rowKey(b)
      const aIdx = orderMap.get(aKey)
      const bIdx = orderMap.get(bKey)
      if (aIdx == null && bIdx == null) return 0
      if (aIdx == null) return 1
      if (bIdx == null) return -1
      return aIdx - bIdx
    })
    return sorted
  }, [renderData, canReorder, customRowOrder, rowKey])

  const handleRowDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setRowDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
    const row = (e.currentTarget as HTMLElement).closest('tr')
    if (row) setTimeout(() => (row.style.opacity = '0.4'), 0)
  }, [])

  const handleRowDragEnd = useCallback((e: React.DragEvent) => {
    const row = (e.currentTarget as HTMLElement).closest('tr')
    if (row) row.style.opacity = '1'
    if (rowDragIdx != null && rowDropIdx != null && rowDragIdx !== rowDropIdx) {
      // Build new order from currently displayed data
      const currentKeys = reorderedData.map(item => rowKey(item))
      const newKeys = [...currentKeys]
      const [moved] = newKeys.splice(rowDragIdx, 1)
      newKeys.splice(rowDropIdx, 0, moved)
      setCustomRowOrder(newKeys)
      saveRowOrder(newKeys)
    }
    setRowDragIdx(null)
    setRowDropIdx(null)
  }, [rowDragIdx, rowDropIdx, reorderedData, rowKey, saveRowOrder])

  const handleRowDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setRowDropIdx(idx)
  }, [])

  /* ---------- Sortable columns list ---------- */
  const sortableColumns = useMemo(() =>
    columns.filter(c => c.sortable).map(c => ({ key: c.key, label: c.label })),
    [columns]
  )

  /* ---------- View panel ---------- */
  const [showViewPanel, setShowViewPanel] = useState(false)
  const [showColumnPanel, setShowColumnPanel] = useState(false)
  const [showSortPanel, setShowSortPanel] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const viewPanelRef = useRef<HTMLDivElement>(null)
  const colPanelRef = useRef<HTMLDivElement>(null)
  const sortPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (viewPanelRef.current && !viewPanelRef.current.contains(e.target as Node)) setShowViewPanel(false)
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setShowColumnPanel(false)
      if (sortPanelRef.current && !sortPanelRef.current.contains(e.target as Node)) setShowSortPanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSaveView = () => {
    if (!newViewName.trim()) return
    saveView(newViewName.trim(), {
      columnOrder,
      columnWidths,
      hiddenColumns: [...hiddenColumns],
      frozenCount,
    })
    setNewViewName('')
  }

  const handleUpdateCurrentView = () => {
    if (!activeViewId) return
    updateView(activeViewId, {
      columnOrder,
      columnWidths,
      hiddenColumns: [...hiddenColumns],
      frozenCount,
    })
  }

  /* ---------- Column context menu ---------- */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; colKey: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const handleColumnContextMenu = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, colKey })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  const contextCol = contextMenu ? columnMap[contextMenu.colKey] : null
  const contextColIdx = contextMenu ? visibleColumns.findIndex(c => c.key === contextMenu.colKey) : -1

  const cellCtx: CellContext = { search }

  /* ---------- Render ---------- */
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Toolbar — Row 1: View tabs */}
      <div className="px-3 pt-2 pb-1 border-b border-gray-100 bg-gray-50/50 space-y-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => switchView(null)}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              !activeViewId ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            默认视图
          </button>
          {views.map(v => (
            <button
              key={v.id}
              onClick={() => switchView(v.id)}
              className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeViewId === v.id ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>

        {/* Toolbar — Row 2: Tool buttons */}
        <div className="flex items-center gap-1 pb-1">
          {/* Save / view config */}
          <div className="relative" ref={viewPanelRef}>
            <button
              onClick={() => { setShowViewPanel(!showViewPanel); setShowColumnPanel(false); setShowSortPanel(false) }}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
              title="视图管理"
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:inline">视图</span>
            </button>
            {showViewPanel && (
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 w-64 p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-700">视图管理</p>
                {views.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {views.map(v => (
                      <div key={v.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 text-sm">
                        <button
                          onClick={() => { switchView(v.id); setShowViewPanel(false) }}
                          className={`text-left truncate flex-1 ${activeViewId === v.id ? 'text-indigo-700 font-medium' : 'text-gray-600'}`}
                        >
                          {v.name}
                        </button>
                        <button
                          onClick={() => deleteView(v.id)}
                          className="p-0.5 text-gray-400 hover:text-red-500 shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {activeViewId && (
                  <button
                    onClick={() => { handleUpdateCurrentView(); setShowViewPanel(false) }}
                    className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    <Save size={12} />
                    保存当前视图
                  </button>
                )}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newViewName}
                    onChange={e => setNewViewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveView() }}
                    placeholder="新视图名称..."
                    className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                  <button
                    onClick={handleSaveView}
                    disabled={!newViewName.trim()}
                    className="p-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-40 hover:bg-indigo-700 transition-colors"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Sort selector */}
          <div className="relative" ref={sortPanelRef}>
            <button
              onClick={() => { setShowSortPanel(!showSortPanel); setShowViewPanel(false); setShowColumnPanel(false) }}
              className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                sortBy ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100' : 'text-gray-500 hover:bg-gray-100'
              }`}
              title="排序"
            >
              <ArrowUpDown size={14} />
              <span className="hidden sm:inline">
                {sortBy ? `${sortableColumns.find(c => c.key === sortBy)?.label || sortBy} · ${sortOrder === 'asc' ? '升序' : '降序'}` : '排序'}
              </span>
            </button>
            {showSortPanel && (
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 w-56 py-1">
                <p className="text-xs font-semibold text-gray-700 px-3 py-1.5">排序字段</p>
                {sortBy && (
                  <button
                    onClick={() => {
                      if (onSort) { /* external sort reset not supported, just clear UI */ }
                      else { setInternalSortBy(null); setInternalSortOrder('asc'); saveSort(null, 'asc') }
                      setShowSortPanel(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <X size={14} />
                    清除排序
                  </button>
                )}
                {sortBy && <div className="border-t border-gray-100 my-1" />}
                {sortableColumns.map(col => (
                  <div key={col.key}>
                    <button
                      onClick={() => {
                        const newOrder = sortBy === col.key && sortOrder === 'asc' ? 'desc' : 'asc'
                        if (onSort) { onSort(col.key, newOrder) }
                        else { setInternalSortBy(col.key); setInternalSortOrder(newOrder); saveSort(col.key, newOrder) }
                        setShowSortPanel(false)
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                        sortBy === col.key ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span>{col.label}</span>
                      {sortBy === col.key && (
                        <span className="flex items-center gap-1 text-indigo-600">
                          {sortOrder === 'asc' ? <ArrowUpNarrowWide size={14} /> : <ArrowDownNarrowWide size={14} />}
                          <span className="text-xs">{sortOrder === 'asc' ? '升序' : '降序'}</span>
                        </span>
                      )}
                    </button>
                  </div>
                ))}
                {sortableColumns.length === 0 && (
                  <p className="px-3 py-2 text-sm text-gray-400">无可排序字段</p>
                )}
              </div>
            )}
          </div>

          {/* Auto-fit column widths */}
          <button
            onClick={autoFitColumns}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
            title="按表头适配列宽"
          >
            <Columns3 size={14} />
          </button>

          {/* Row height selector */}
          <button
            onClick={() => {
              const opts: RowHeight[] = ['compact', 'default', 'comfortable']
              const cur = opts.indexOf(rowHeight)
              const next = opts[(cur + 1) % opts.length]
              setRowHeight(next)
              localStorage.setItem('table-rowHeight:' + storageKey, next)
            }}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
            title={`行高：${rowHeightLabels[rowHeight]}（点击切换）`}
          >
            <AlignVerticalSpaceAround size={14} />
            <span className="hidden sm:inline">{rowHeightLabels[rowHeight]}</span>
          </button>

          {/* Column visibility */}
          <div className="relative" ref={colPanelRef}>
            <button
              onClick={() => { setShowColumnPanel(!showColumnPanel); setShowViewPanel(false); setShowSortPanel(false) }}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
              title="字段配置"
            >
              <Eye size={14} />
            </button>
            {showColumnPanel && (
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 w-56 p-2 space-y-0.5 max-h-80 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-700 px-2 py-1.5">字段配置</p>
                {columnOrder.map(key => {
                  const col = columnMap[key]
                  if (!col) return null
                  const visible = !hiddenColumns.has(key)
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleColumn(key)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className={`text-sm ${visible ? 'text-gray-700' : 'text-gray-400'}`}>{col.label}</span>
                    </label>
                  )
                })}
                <div className="border-t border-gray-100 mt-1 pt-1 px-2">
                  <label className="flex items-center gap-2 py-1.5 text-sm text-gray-600">
                    <span>冻结前</span>
                    <select
                      value={frozenCount}
                      onChange={e => setFrozenCount(Number(e.target.value))}
                      className="px-1.5 py-0.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                    >
                      {[0, 1, 2, 3].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span>列</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-12 text-center text-gray-400">
          <div className="inline-block w-6 h-6 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />
          <p className="mt-2 text-sm">加载中...</p>
        </div>
      ) : (
        <>
          <div ref={tableRef} className="overflow-x-auto">
            <table className="w-full text-sm border-collapse" style={{ minWidth: 'max-content' }}>
              {/* Header */}
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {canReorder && (
                    <th className={`${rowPy} px-1 w-8 bg-gray-50 border-r border-gray-100`} />
                  )}
                  {selectable && (
                    <th
                      className={`${rowPy} px-3 w-11 bg-gray-50 border-r border-gray-100`}
                      style={frozenCount > 0 ? { position: 'sticky', left: canReorder ? 32 : 0, zIndex: 20, backgroundColor: '#f9fafb' } : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                  )}
                  {visibleColumns.map((col, idx) => {
                    const isFrozen = idx < frozenCount
                    const width = columnWidths[col.key] || 150
                    return (
                      <th
                        key={col.key}
                        className={`relative ${rowPy} px-3 text-left font-medium text-gray-600 select-none border-r border-gray-100 group ${
                          col.headerClassName || ''
                        } ${dragOverKey === col.key && dragKey !== col.key ? 'bg-indigo-50' : 'bg-gray-50'} ${
                          isFrozen ? 'z-10' : ''
                        }`}
                        style={{
                          width,
                          minWidth: col.minWidth || 60,
                          maxWidth: width,
                          ...(isFrozen ? {
                            position: 'sticky' as const,
                            left: frozenOffsets[col.key] ?? 0,
                            backgroundColor: dragOverKey === col.key && dragKey !== col.key ? undefined : '#f9fafb',
                            ...(isLastFrozen(idx) ? { boxShadow: lastFrozenShadow } : {}),
                          } : {}),
                        }}
                        draggable
                        onDragStart={e => handleDragStart(e, col.key)}
                        onDragEnd={handleDragEnd}
                        onDragOver={e => handleDragOver(e, col.key)}
                        onContextMenu={e => handleColumnContextMenu(e, col.key)}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <GripVertical size={12} className="shrink-0 text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab transition-opacity" />
                          <span
                            className={`truncate ${col.sortable ? 'cursor-pointer hover:text-indigo-600' : ''}`}
                            onClick={() => col.sortable && handleSort(col.key)}
                          >
                            {col.label}
                          </span>
                          {col.sortable && sortBy === col.key && (
                            <span className="shrink-0 text-indigo-600">
                              {sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </span>
                          )}
                          {col.headerExtra && (
                            <span className="shrink-0" onClick={e => e.stopPropagation()}>
                              {col.headerExtra}
                            </span>
                          )}
                        </div>
                        {/* Resize handle */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400 transition-colors"
                          onMouseDown={e => handleResizeStart(e, col.key)}
                        />
                      </th>
                    )
                  })}
                </tr>
              </thead>

              {/* Body */}
              <tbody>
                {reorderedData.length > 0 ? reorderedData.map((item, rowIdx) => {
                  const id = rowKey(item)
                  const isActive = activeRowId != null && id === activeRowId
                  const isSelected = selectedIds?.has(id as number)
                  const isDropTarget = canReorder && rowDropIdx === rowIdx && rowDragIdx !== rowIdx
                  return (
                    <tr
                      key={id}
                      className={`group/row border-b transition-colors cursor-pointer ${
                        isDropTarget
                          ? 'border-t-2 border-t-indigo-400 border-b-gray-50'
                          : 'border-b-gray-50'
                      } ${
                        isActive
                          ? 'bg-indigo-50'
                          : isSelected
                            ? 'bg-indigo-50'
                            : 'hover:bg-gray-50'
                      }`}
                      onClick={() => onRowClick?.(item)}
                      draggable={canReorder}
                      onDragStart={canReorder ? e => handleRowDragStart(e, rowIdx) : undefined}
                      onDragEnd={canReorder ? handleRowDragEnd : undefined}
                      onDragOver={canReorder ? e => handleRowDragOver(e, rowIdx) : undefined}
                    >
                      {canReorder && (
                        <td
                          className={`${rowPy} px-1 border-r border-gray-50 cursor-grab active:cursor-grabbing ${isActive ? 'bg-indigo-50' : isSelected ? 'bg-indigo-50' : 'bg-white group-hover/row:bg-gray-50'}`}
                          onClick={e => e.stopPropagation()}
                        >
                          <GripVertical size={14} className="text-gray-300 mx-auto" />
                        </td>
                      )}
                      {selectable && (
                        <td
                          className={`${rowPy} px-3 border-r border-gray-50 ${isActive ? 'bg-indigo-50' : isSelected ? 'bg-indigo-50' : 'bg-white group-hover/row:bg-gray-50'}`}
                          style={frozenCount > 0 ? { position: 'sticky', left: canReorder ? 32 : 0, zIndex: 10, backgroundColor: isActive || isSelected ? '#eef2ff' : '#ffffff' } : undefined}
                          onClick={e => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={!!isSelected}
                            onChange={() => toggleSelect(id as number)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                      )}
                      {visibleColumns.map((col, idx) => {
                        const isFrozen = idx < frozenCount
                        const width = columnWidths[col.key] || 150
                        const cellCls = typeof col.cellClassName === 'function'
                          ? col.cellClassName(item, cellCtx)
                          : col.cellClassName || ''
                        return (
                          <td
                            key={col.key}
                            className={`${rowPy} px-3 border-r border-gray-50 overflow-hidden ${cellCls} ${
                              isFrozen ? (isActive ? 'bg-indigo-50' : isSelected ? 'bg-indigo-50' : 'bg-white group-hover/row:bg-gray-50') : ''
                            }`}
                            style={{
                              width,
                              minWidth: col.minWidth || 60,
                              maxWidth: width,
                              ...(isFrozen ? {
                                position: 'sticky' as const,
                                left: frozenOffsets[col.key] ?? 0,
                                zIndex: 10,
                                backgroundColor: isActive || isSelected ? '#eef2ff' : '#ffffff',
                                ...(isLastFrozen(idx) ? { boxShadow: lastFrozenShadow } : {}),
                              } : {}),
                            }}
                            onClick={col.key === 'tags' ? e => e.stopPropagation() : undefined}
                          >
                            <div className="truncate">
                              {col.cell(item, cellCtx)}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={visibleColumns.length + (selectable ? 1 : 0) + (canReorder ? 1 : 0)} className="py-16 text-center text-gray-400">
                      {emptyContent || <p>暂无数据</p>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer: total count + display count selector */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/30">
            <span className="text-xs text-gray-500">
              共 {total || reorderedData.length} 条
              {reorderedData.length < (total || reorderedData.length) ? `，当前显示 ${reorderedData.length} 条` : ''}
              {reorderable && sortBy && <span className="text-gray-400 ml-2">（排序中，无法拖拽行）</span>}
            </span>
            {onDisplayCountChange && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">显示</span>
                <select
                  value={displayCount ?? displayCountOptions[0]}
                  onChange={e => {
                    const val = Number(e.target.value)
                    onDisplayCountChange(val)
                    saveDisplayCount(val)
                  }}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
                >
                  {displayCountOptions.map(n => (
                    <option key={n} value={n}>{n} 条</option>
                  ))}
                  <option value={9999}>全部</option>
                </select>
              </div>
            )}
          </div>
        </>
      )}

      {/* Column context menu */}
      {contextMenu && contextCol && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-48"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextCol.sortable && (
            <>
              <button
                onClick={() => { handleSort(contextMenu.colKey); if (sortBy !== contextMenu.colKey || sortOrder !== 'asc') { if (!onSort) { setInternalSortBy(contextMenu.colKey); setInternalSortOrder('asc'); saveSort(contextMenu.colKey, 'asc') } else { onSort(contextMenu.colKey, 'asc') } } setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <ArrowUpNarrowWide size={14} className="text-gray-400" />
                升序排列
                {sortBy === contextMenu.colKey && sortOrder === 'asc' && <span className="ml-auto text-indigo-600 text-xs">✓</span>}
              </button>
              <button
                onClick={() => { if (!onSort) { setInternalSortBy(contextMenu.colKey); setInternalSortOrder('desc'); saveSort(contextMenu.colKey, 'desc') } else { onSort(contextMenu.colKey, 'desc') } setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <ArrowDownNarrowWide size={14} className="text-gray-400" />
                降序排列
                {sortBy === contextMenu.colKey && sortOrder === 'desc' && <span className="ml-auto text-indigo-600 text-xs">✓</span>}
              </button>
              <div className="border-t border-gray-100 my-1" />
            </>
          )}
          <button
            onClick={() => { toggleColumn(contextMenu.colKey); setContextMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <EyeOff size={14} className="text-gray-400" />
            隐藏此字段
          </button>
          {contextColIdx >= 0 && (
            <button
              onClick={() => {
                const newFrozen = contextColIdx < frozenCount ? contextColIdx : contextColIdx + 1
                setFrozenCount(newFrozen)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {contextColIdx < frozenCount ? (
                <><Unlock size={14} className="text-gray-400" />取消冻结</>
              ) : (
                <><Lock size={14} className="text-gray-400" />冻结到此列</>
              )}
            </button>
          )}
          <div className="border-t border-gray-100 my-1" />
          <button
            onClick={() => {
              const defaultWidth = columnMap[contextMenu.colKey]?.width || 150
              setColumnWidths(prev => ({ ...prev, [contextMenu.colKey]: defaultWidth }))
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <RotateCcw size={14} className="text-gray-400" />
            重置列宽
          </button>
          {reorderable && customRowOrder.length > 0 && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { setCustomRowOrder([]); clearRowOrder(); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <RotateCcw size={14} className="text-gray-400" />
                重置行顺序
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
