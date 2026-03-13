export { DataTable } from './DataTable'
export type { DataTableColumn, DataTableProps } from './DataTable'
export { useTableViews } from './useTableViews'
export type { TableView } from './useTableViews'

/** Read persisted display count for a storage key (user-aware) */
export function getPersistedDisplayCount(storageKey: string, defaultCount = 50): number {
  try {
    let prefix = ''
    const raw = localStorage.getItem('user')
    if (raw) {
      const user = JSON.parse(raw)
      if (user?.feishu_open_id) prefix = user.feishu_open_id + ':'
    }
    const val = localStorage.getItem('table-views:' + prefix + storageKey + ':displayCount')
    return val ? Number(val) : defaultCount
  } catch {
    return defaultCount
  }
}
