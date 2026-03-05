import { useEffect, useRef } from 'react'
import GlobalSearch from './GlobalSearch'

interface Props {
  open: boolean
  onClose: () => void
}

export default function HeaderSearch({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[65vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5">
          <GlobalSearch onNavigate={onClose} />
        </div>
      </div>
    </div>
  )
}
