import { useState } from 'react'
import { X, Upload, File, AudioWaveform, FileText, Table2, Loader2 } from 'lucide-react'
import type { ImportCategory } from './importUtils'
import { CATEGORY_CONFIG, formatFileSize, getFileTypeLabel } from './importUtils'

interface ImportConfirmModalProps {
  open: boolean
  files: File[]
  recommendedCategory: ImportCategory
  onConfirm: (category: ImportCategory, files: File[]) => Promise<void>
  onClose: () => void
}

const CATEGORY_OPTIONS: ImportCategory[] = ['communication', 'document', 'structured']

const CATEGORY_ICONS: Record<string, typeof AudioWaveform> = {
  communication: AudioWaveform,
  document: FileText,
  structured: Table2,
}

export default function ImportConfirmModal({
  open,
  files,
  recommendedCategory,
  onConfirm,
  onClose,
}: ImportConfirmModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<ImportCategory>(recommendedCategory)
  const [uploading, setUploading] = useState(false)

  if (!open) return null

  const handleConfirm = async () => {
    setUploading(true)
    try {
      await onConfirm(selectedCategory, files)
    } finally {
      setUploading(false)
    }
  }

  // 获取主要文件类型
  const primaryExt = files[0]?.name.split('.').pop()?.toLowerCase() || ''
  const fileTypeLabel = getFileTypeLabel(primaryExt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">确认上传</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            disabled={uploading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 检测到的文件类型 */}
          <div className="mb-5">
            <p className="text-sm text-gray-600 mb-1">
              检测到您上传的是
              <span className="font-medium text-gray-900"> {fileTypeLabel} </span>
              {files.length > 1 && (
                <span className="text-gray-500">（共 {files.length} 个文件）</span>
              )}
            </p>
          </div>

          {/* 分类选择 */}
          <div className="mb-5">
            <p className="text-sm font-medium text-gray-700 mb-3">归类至：</p>
            <div className="grid grid-cols-3 gap-3">
              {CATEGORY_OPTIONS.map((cat) => {
                const config = CATEGORY_CONFIG[cat]
                const IconComponent = CATEGORY_ICONS[cat]
                const isSelected = selectedCategory === cat
                const isRecommended = recommendedCategory === cat

                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    disabled={uploading}
                    className={`
                      relative p-3 rounded-xl border-2 transition-all
                      ${isSelected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                      }
                    `}
                  >
                    {isRecommended && (
                      <span className="absolute -top-2 -right-2 px-1.5 py-0.5 text-xs bg-indigo-600 text-white rounded-full">
                        推荐
                      </span>
                    )}
                    <div className="flex flex-col items-center">
                      <IconComponent className={`w-6 h-6 mb-1 ${isSelected ? 'text-indigo-600' : 'text-gray-400'}`} />
                      <span className={`text-sm ${isSelected ? 'text-indigo-600 font-medium' : 'text-gray-600'}`}>
                        {config.categoryName}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 文件列表 */}
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">文件列表</p>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 px-4 py-2 border-b border-gray-50 last:border-b-0"
                >
                  <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="flex-1 text-sm text-gray-700 truncate">{file.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatFileSize(file.size)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                上传中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                确认上传
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}