import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-start justify-center pt-[12vh]"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -5 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="apple-glass-heavy rounded-2xl w-full max-w-2xl max-h-[65vh] overflow-auto"
            style={{ boxShadow: 'var(--shadow-float)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5">
              <GlobalSearch onNavigate={onClose} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
