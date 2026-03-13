import { useState, useCallback } from 'react'

export interface TableView {
  id: string
  name: string
  columnOrder: string[]
  columnWidths: Record<string, number>
  hiddenColumns: string[]
  frozenCount: number
}

function getUserPrefix(): string {
  try {
    const raw = localStorage.getItem('user')
    if (raw) {
      const user = JSON.parse(raw)
      if (user?.feishu_open_id) return user.feishu_open_id + ':'
    }
  } catch { /* ignore */ }
  return ''
}

const STORAGE_PREFIX = 'table-views:'

function getFullKey(storageKey: string): string {
  return STORAGE_PREFIX + getUserPrefix() + storageKey
}

function loadViews(storageKey: string): TableView[] {
  try {
    const raw = localStorage.getItem(getFullKey(storageKey))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function loadActiveId(storageKey: string): string | null {
  try {
    return localStorage.getItem(getFullKey(storageKey) + ':active')
  } catch {
    return null
  }
}

export function useTableViews(storageKey: string, _defaultColumnKeys?: string[]) {
  const [views, setViews] = useState<TableView[]>(() => loadViews(storageKey))
  const [activeViewId, setActiveViewId] = useState<string | null>(() => loadActiveId(storageKey))

  const persist = useCallback((updated: TableView[]) => {
    setViews(updated)
    localStorage.setItem(getFullKey(storageKey), JSON.stringify(updated))
  }, [storageKey])

  const activeView = views.find(v => v.id === activeViewId) || null

  const saveView = useCallback((name: string, config: Omit<TableView, 'id' | 'name'>) => {
    const id = Date.now().toString(36)
    const view: TableView = { id, name, ...config }
    const updated = [...views, view]
    persist(updated)
    setActiveViewId(id)
    localStorage.setItem(getFullKey(storageKey) + ':active', id)
    return view
  }, [views, persist, storageKey])

  const updateView = useCallback((id: string, config: Partial<Omit<TableView, 'id'>>) => {
    const updated = views.map(v => v.id === id ? { ...v, ...config } : v)
    persist(updated)
  }, [views, persist])

  const deleteView = useCallback((id: string) => {
    const updated = views.filter(v => v.id !== id)
    persist(updated)
    if (activeViewId === id) {
      setActiveViewId(null)
      localStorage.removeItem(getFullKey(storageKey) + ':active')
    }
  }, [views, persist, activeViewId, storageKey])

  const switchView = useCallback((id: string | null) => {
    setActiveViewId(id)
    if (id) {
      localStorage.setItem(getFullKey(storageKey) + ':active', id)
    } else {
      localStorage.removeItem(getFullKey(storageKey) + ':active')
    }
  }, [storageKey])

  // Row order persistence
  const rowOrderKey = getFullKey(storageKey) + ':rowOrder'

  const loadRowOrder = useCallback((): (string | number)[] => {
    try {
      const raw = localStorage.getItem(rowOrderKey)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }, [rowOrderKey])

  const saveRowOrder = useCallback((order: (string | number)[]) => {
    // Only persist the first 500 IDs to keep localStorage lean
    const trimmed = order.slice(0, 500)
    localStorage.setItem(rowOrderKey, JSON.stringify(trimmed))
  }, [rowOrderKey])

  const clearRowOrder = useCallback(() => {
    localStorage.removeItem(rowOrderKey)
  }, [rowOrderKey])

  // Default view config persistence (auto-save when no named view is active)
  const defaultConfigKey = getFullKey(storageKey) + ':defaultConfig'

  const loadDefaultConfig = useCallback((): Omit<TableView, 'id' | 'name'> | null => {
    try {
      const raw = localStorage.getItem(defaultConfigKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }, [defaultConfigKey])

  const saveDefaultConfig = useCallback((config: Omit<TableView, 'id' | 'name'>) => {
    localStorage.setItem(defaultConfigKey, JSON.stringify(config))
  }, [defaultConfigKey])

  // Sort persistence
  const sortKey = getFullKey(storageKey) + ':sort'

  const loadSort = useCallback((): { sortBy: string; sortOrder: 'asc' | 'desc' } | null => {
    try {
      const raw = localStorage.getItem(sortKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }, [sortKey])

  const saveSort = useCallback((sortBy: string | null, sortOrder: 'asc' | 'desc') => {
    if (sortBy) {
      localStorage.setItem(sortKey, JSON.stringify({ sortBy, sortOrder }))
    } else {
      localStorage.removeItem(sortKey)
    }
  }, [sortKey])

  // Display count persistence
  const displayCountKey = getFullKey(storageKey) + ':displayCount'

  const loadDisplayCount = useCallback((defaultCount: number): number => {
    try {
      const raw = localStorage.getItem(displayCountKey)
      return raw ? Number(raw) : defaultCount
    } catch {
      return defaultCount
    }
  }, [displayCountKey])

  const saveDisplayCount = useCallback((count: number) => {
    localStorage.setItem(displayCountKey, String(count))
  }, [displayCountKey])

  return {
    views,
    activeView,
    activeViewId,
    saveView,
    updateView,
    deleteView,
    switchView,
    loadDisplayCount,
    saveDisplayCount,
    loadDefaultConfig,
    saveDefaultConfig,
    loadRowOrder,
    saveRowOrder,
    clearRowOrder,
    loadSort,
    saveSort,
  }
}
