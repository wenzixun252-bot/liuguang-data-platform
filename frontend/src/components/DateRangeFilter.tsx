import { useState, useEffect, useRef } from 'react'
import { Filter } from 'lucide-react'

interface DateRangeFilterProps {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setDraftFrom(from) }, [from])
  useEffect(() => { setDraftTo(to) }, [to])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isActive = from !== '' || to !== ''

  const handleConfirm = () => {
    onChange(draftFrom, draftTo)
    setOpen(false)
  }

  const handleReset = () => {
    setDraftFrom('')
    setDraftTo('')
    onChange('', '')
    setOpen(false)
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
        title="时间筛选"
      >
        <Filter size={12} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 w-56 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">开始日期</label>
              <input
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-1 focus:ring-indigo-200 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">结束日期</label>
              <input
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-1 focus:ring-indigo-200 outline-none"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-3">
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
