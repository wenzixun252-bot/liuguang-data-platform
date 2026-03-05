import { useState, useRef, useEffect } from 'react'
import { Settings2 } from 'lucide-react'

export interface ColumnDef {
  key: string
  label: string
  defaultVisible?: boolean  // 默认 true
}

/**
 * 列配置下拉菜单组件。
 * 配置持久化到 localStorage，key 为 `columns:{storageKey}`。
 */
export function useColumnSettings(storageKey: string, columns: ColumnDef[]) {
  const lsKey = `columns:${storageKey}`

  const [visible, setVisible] = useState<Set<string>>(() => {
    const defaults = new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.key))
    try {
      const saved = localStorage.getItem(lsKey)
      if (saved) {
        const savedSet = new Set(JSON.parse(saved) as string[])
        // 把新增的默认可见列也加进去（用户之前保存时还没有这些列）
        for (const key of defaults) {
          if (!savedSet.has(key)) savedSet.add(key)
        }
        return savedSet
      }
    } catch { /* ignore */ }
    return defaults
  })

  const toggle = (key: string) => {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size <= 1) return prev // 至少保留一列
        next.delete(key)
      } else {
        next.add(key)
      }
      localStorage.setItem(lsKey, JSON.stringify([...next]))
      return next
    })
  }

  const isVisible = (key: string) => visible.has(key)

  return { visible, toggle, isVisible, columns }
}

export function ColumnSettingsButton({
  columns,
  isVisible,
  toggle,
}: {
  columns: ColumnDef[]
  isVisible: (key: string) => boolean
  toggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        title="列设置"
      >
        <Settings2 size={16} />
        <span className="hidden sm:inline">列设置</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-20 min-w-[160px]">
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm text-gray-700"
            >
              <input
                type="checkbox"
                checked={isVisible(col.key)}
                onChange={() => toggle(col.key)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
