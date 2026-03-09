import { AudioWaveform, FileText, Table2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ImportCategory } from './importUtils'
import { CATEGORY_CONFIG } from './importUtils'

interface CategoryCardProps {
  category: ImportCategory
  isActive?: boolean
  onClick?: () => void
}

// 图标映射
const ICON_MAP: Record<string, LucideIcon> = {
  AudioWaveform,
  FileText,
  Table2,
}

export default function CategoryCard({ category, isActive = false, onClick }: CategoryCardProps) {
  const config = CATEGORY_CONFIG[category]
  const IconComponent = ICON_MAP[config.icon] || FileText

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left p-4 rounded-xl border transition-all duration-200
        bg-white hover:shadow-md hover:-translate-y-0.5
        ${isActive
          ? 'border-indigo-400 ring-2 ring-indigo-100 shadow-md'
          : 'border-gray-200 hover:border-indigo-200'
        }
      `}
    >
      {/* 图标和标题 */}
      <div className="flex items-center gap-3 mb-2">
        <div className={`
          w-10 h-10 rounded-lg flex items-center justify-center
          ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'}
        `}>
          <IconComponent className="w-5 h-5" />
        </div>
        <span className="font-medium text-gray-900">{config.categoryName}</span>
      </div>

      {/* 描述 */}
      <p className="text-sm text-gray-500 mb-3">{config.description}</p>

      {/* 支持格式 */}
      <div className="flex flex-wrap gap-1.5">
        {config.extensions.slice(0, 3).map((ext) => (
          <span
            key={ext}
            className="px-2 py-0.5 text-xs rounded bg-gray-50 text-gray-600"
          >
            {ext}
          </span>
        ))}
      </div>
    </button>
  )
}