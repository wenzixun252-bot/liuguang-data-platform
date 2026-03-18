import { useEffect } from 'react'
import { X, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react'
import type { WidgetConfig, WidgetId } from '../../hooks/useWidgetConfig'

const WIDGET_LABELS: Record<WidgetId, string> = {
  'asset-score': '数据评分',
  'data-graph': '数据图谱',
  'trend': '趋势分析',
}

export default function WidgetConfigModal({
  configs,
  onToggle,
  onMove,
  onReset,
  onClose,
}: {
  configs: WidgetConfig[]
  onToggle: (id: WidgetId) => void
  onMove: (id: WidgetId, direction: 'up' | 'down') => void
  onReset: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">配置面板</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-2">
          {configs.map((config, idx) => (
            <div
              key={config.id}
              className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg"
            >
              {/* Toggle */}
              <button
                onClick={() => onToggle(config.id)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  config.enabled ? 'bg-indigo-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    config.enabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>

              {/* Label */}
              <span className={`flex-1 text-sm font-medium ${config.enabled ? 'text-gray-800' : 'text-gray-400'}`}>
                {WIDGET_LABELS[config.id]}
              </span>

              {/* Move buttons */}
              <button
                onClick={() => onMove(config.id, 'up')}
                disabled={idx === 0}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                <ChevronUp size={16} />
              </button>
              <button
                onClick={() => onMove(config.id, 'down')}
                disabled={idx === configs.length - 1}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                <ChevronDown size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            <RotateCcw size={14} />
            恢复默认
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
