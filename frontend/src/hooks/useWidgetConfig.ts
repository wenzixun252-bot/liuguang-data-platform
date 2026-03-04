import { useState, useCallback } from 'react'

export type WidgetId = 'data-graph' | 'trend'

export interface WidgetConfig {
  id: WidgetId
  enabled: boolean
  order: number
  settings: Record<string, unknown>
}

const STORAGE_KEY = 'liuguang-widget-config-v2'

const DEFAULT_CONFIGS: WidgetConfig[] = [
  { id: 'data-graph', enabled: true, order: 0, settings: {} },
  { id: 'trend', enabled: true, order: 1, settings: {} },
]

function loadConfigs(): WidgetConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as WidgetConfig[]
      if (Array.isArray(parsed) && parsed.length === DEFAULT_CONFIGS.length) {
        return parsed
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_CONFIGS.map(c => ({ ...c }))
}

function saveConfigs(configs: WidgetConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
}

export function useWidgetConfig() {
  const [configs, setConfigs] = useState<WidgetConfig[]>(loadConfigs)

  const update = useCallback((next: WidgetConfig[]) => {
    setConfigs(next)
    saveConfigs(next)
  }, [])

  const toggleWidget = useCallback((id: WidgetId) => {
    const next = configs.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c)
    update(next)
  }, [configs, update])

  const moveWidget = useCallback((id: WidgetId, direction: 'up' | 'down') => {
    const sorted = [...configs].sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex(c => c.id === id)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const temp = sorted[idx].order
    sorted[idx] = { ...sorted[idx], order: sorted[swapIdx].order }
    sorted[swapIdx] = { ...sorted[swapIdx], order: temp }
    update(sorted)
  }, [configs, update])

  const updateSettings = useCallback((id: WidgetId, settings: Record<string, unknown>) => {
    const next = configs.map(c => c.id === id ? { ...c, settings: { ...c.settings, ...settings } } : c)
    update(next)
  }, [configs, update])

  const resetToDefault = useCallback(() => {
    update(DEFAULT_CONFIGS.map(c => ({ ...c })))
  }, [update])

  const sortedConfigs = [...configs].sort((a, b) => a.order - b.order)
  const enabledConfigs = sortedConfigs.filter(c => c.enabled)

  return {
    configs: sortedConfigs,
    enabledConfigs,
    toggleWidget,
    moveWidget,
    updateSettings,
    resetToDefault,
  }
}
