import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../lib/api'

interface Archiver {
  name: string
  avatar_url: string | null
  archived_at: string | null
}

interface ArchiverPopoverProps {
  contentType: 'document' | 'structured_table'
  contentId: number
  importCount: number
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const d = new Date(dateStr).getTime()
  const diff = now - d
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

export default function ArchiverPopover({ contentType, contentId, importCount }: ArchiverPopoverProps) {
  const [open, setOpen] = useState(false)
  const [archivers, setArchivers] = useState<Archiver[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const colorClass = importCount >= 10
    ? 'bg-amber-50 text-amber-700 border-amber-300 font-semibold'
    : importCount >= 5
      ? 'bg-purple-50 text-purple-600 border-purple-200'
      : 'bg-indigo-50 text-indigo-600 border-indigo-200'

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = badgeRef.current?.getBoundingClientRect()
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
    if (!archivers) {
      setLoading(true)
      const endpoint = contentType === 'document'
        ? `/documents/${contentId}/archivers`
        : `/structured-tables/${contentId}/archivers`
      api.get(endpoint)
        .then((res) => setArchivers(res.data.archivers))
        .catch(() => setArchivers([]))
        .finally(() => setLoading(false))
    }
  }

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        badgeRef.current && !badgeRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleScroll = () => setOpen(false)
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  return (
    <>
      <span
        ref={badgeRef}
        onClick={handleClick}
        className={`shrink-0 px-1.5 py-0.5 rounded text-xs border cursor-pointer hover:ring-1 hover:ring-indigo-300 transition-shadow ${colorClass}`}
        title={`${importCount} 人已归档，点击查看`}
      >
        {importCount >= 10 ? '\ud83d\udd25 ' : ''}{importCount} 人归档
      </span>
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed bg-white border border-gray-200 rounded-xl shadow-xl z-[100] w-64 overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/50">
            <span className="text-sm font-medium text-gray-700">{importCount} 人已归档</span>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 text-center text-sm text-gray-400">加载中...</div>
            ) : archivers && archivers.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {archivers.map((a, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                    {a.avatar_url ? (
                      <img src={a.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-medium shrink-0">
                        {a.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-800 font-medium truncate">{a.name}</div>
                      {a.archived_at && (
                        <div className="text-xs text-gray-400">{relativeTime(a.archived_at)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 text-center text-sm text-gray-400">暂无归档人信息</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
