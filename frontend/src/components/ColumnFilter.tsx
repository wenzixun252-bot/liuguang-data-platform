import { useState, useEffect, useRef } from 'react'
import { Filter } from 'lucide-react'

interface ColumnFilterProps {
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
}

export function ColumnFilter({ options, selected, onChange }: ColumnFilterProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<string[]>(selected)
  const ref = useRef<HTMLDivElement>(null)

  // 同步外部 selected 到 draft
  useEffect(() => { setDraft(selected) }, [selected])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options

  const isActive = selected.length > 0

  const toggleItem = (item: string) => {
    setDraft((prev) =>
      prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item],
    )
  }

  const handleConfirm = () => {
    onChange(draft)
    setOpen(false)
    setSearch('')
  }

  const handleReset = () => {
    setDraft([])
    onChange([])
    setOpen(false)
    setSearch('')
  }

  const handleSelectAll = () => {
    setDraft(filtered.length === draft.length ? [] : [...filtered])
  }

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={`p-0.5 rounded transition-colors ${
          isActive
            ? 'text-indigo-600 hover:text-indigo-800'
            : 'text-gray-400 hover:text-gray-600'
        }`}
        title="筛选"
      >
        <Filter size={12} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 w-52"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 搜索框 */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-1 focus:ring-indigo-200 outline-none"
              autoFocus
            />
          </div>

          {/* 全选/取消 */}
          <div className="px-2 py-1 border-b border-gray-100">
            <button
              onClick={handleSelectAll}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {draft.length === filtered.length ? '取消全选' : '全选'}
            </button>
          </div>

          {/* 选项列表 */}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">无匹配项</div>
            ) : (
              filtered.map((item) => (
                <label
                  key={item}
                  className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={draft.includes(item)}
                    onChange={() => toggleItem(item)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-200"
                  />
                  <span className="truncate">{item || '(空)'}</span>
                </label>
              ))
            )}
          </div>

          {/* 底部按钮 */}
          <div className="flex gap-2 p-2 border-t border-gray-100">
            <button
              onClick={handleReset}
              className="flex-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded transition-colors"
            >
              重置
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 px-2 py-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded transition-colors"
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
