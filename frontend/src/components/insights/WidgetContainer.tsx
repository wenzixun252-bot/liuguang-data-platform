import type { ReactNode, DragEvent } from 'react'
import { X, RefreshCw } from 'lucide-react'

interface WidgetContainerProps {
  id: string
  title: string
  icon: ReactNode
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onClose?: () => void
  onDragStart?: (e: DragEvent, id: string) => void
  onDragOver?: (e: DragEvent) => void
  onDrop?: (e: DragEvent, id: string) => void
  className?: string
  headerExtra?: ReactNode
  children: ReactNode
}

export default function WidgetContainer({
  id,
  title,
  icon,
  loading,
  error,
  onRetry,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
  className = '',
  headerExtra,
  children,
}: WidgetContainerProps) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm p-6 ${className}`}
      draggable={!!onDragStart}
      onDragStart={onDragStart ? (e) => onDragStart(e, id) : undefined}
      onDragOver={onDragOver ? (e) => { e.preventDefault(); onDragOver(e) } : undefined}
      onDrop={onDrop ? (e) => onDrop(e, id) : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-indigo-500">{icon}</span>
          <h3 className="text-lg font-semibold text-gray-700">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="隐藏"
          >
            <X size={16} />
          </button>
        )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="h-20 bg-gray-200 rounded" />
        </div>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-red-500 mb-3">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
            >
              <RefreshCw size={14} />
              重试
            </button>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
