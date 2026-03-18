import { useState, useEffect, useMemo } from 'react'
import { X, FolderOpen, ChevronDown, ChevronRight, AlertTriangle, Info, File, AudioWaveform, FileText, Table2 } from 'lucide-react'
import type { ImportCategory } from './importUtils'
import { CATEGORY_CONFIG, formatFileSize, groupFilesByCategory, extractFolderName } from './importUtils'

interface FolderImportPreviewModalProps {
  open: boolean
  files: File[]
  extractionRuleId: number | null
  cleaningRuleId: number | null
  extractionRuleName?: string
  cleaningRuleName?: string
  onConfirm: (categorizedFiles: Record<ImportCategory, File[]>) => void
  onClose: () => void
}

const CATEGORY_ICONS: Record<string, typeof AudioWaveform> = {
  communication: AudioWaveform,
  document: FileText,
  structured: Table2,
}

const STRUCTURED_MAX_SIZE = 20 * 1024 * 1024 // 20MB

export default function FolderImportPreviewModal({
  open,
  files,
  extractionRuleId,
  cleaningRuleId,
  extractionRuleName,
  cleaningRuleName,
  onConfirm,
  onClose,
}: FolderImportPreviewModalProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['communication', 'document', 'structured']))

  const categorized = useMemo(() => groupFilesByCategory(files), [files])
  const folderName = useMemo(() => extractFolderName(files), [files])
  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files])

  const importableCount = categorized.communication.length + categorized.document.length + categorized.structured.length
  const hasAudio = categorized.communication.length > 0
  const hasUnknown = categorized.unknown.length > 0

  // Escape 关闭
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // 弹窗打开时重置展开状态
  useEffect(() => {
    if (open) {
      setExpandedSections(new Set(['communication', 'document', 'structured']))
    }
  }, [open])

  if (!open) return null

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const handleConfirm = () => {
    onConfirm(categorized)
  }

  const renderFileList = (category: ImportCategory) => {
    const categoryFiles = categorized[category]
    if (categoryFiles.length === 0) return null

    const isExpanded = expandedSections.has(category)
    const config = CATEGORY_CONFIG[category]
    const IconComp = CATEGORY_ICONS[category]

    return (
      <div key={category} className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
          onClick={() => toggleSection(category)}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
          )}
          <IconComp className="w-4 h-4 text-gray-500 shrink-0" />
          <span className="text-sm font-medium text-gray-700 flex-1">{config.categoryName}</span>
          <span className="text-xs text-gray-400">{categoryFiles.length} 个文件</span>
        </button>
        {isExpanded && (
          <div className="max-h-60 overflow-y-auto">
            {categoryFiles.map((file, idx) => {
              const isOversized = category === 'structured' && file.size > STRUCTURED_MAX_SIZE
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-4 py-1.5 border-t border-gray-100 text-xs"
                >
                  <File className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="flex-1 text-gray-600 truncate">
                    {file.webkitRelativePath || file.name}
                  </span>
                  {isOversized && (
                    <span className="text-red-500 font-medium shrink-0">超出大小限制</span>
                  )}
                  <span className="text-gray-400 shrink-0">{formatFileSize(file.size)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-indigo-500" />
            <h3 className="text-lg font-semibold text-gray-900">{folderName}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 概要 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-600">{files.length} 个文件</span>
            <span className="text-gray-300">|</span>
            <span className="text-sm text-gray-600">{formatFileSize(totalSize)}</span>
            <span className="text-gray-300">|</span>
            <div className="flex items-center gap-2 flex-wrap">
              {categorized.communication.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs">
                  <AudioWaveform className="w-3 h-3" />
                  {categorized.communication.length}
                </span>
              )}
              {categorized.document.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs">
                  <FileText className="w-3 h-3" />
                  {categorized.document.length}
                </span>
              )}
              {categorized.structured.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs">
                  <Table2 className="w-3 h-3" />
                  {categorized.structured.length}
                </span>
              )}
              {hasUnknown && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-xs">
                  <AlertTriangle className="w-3 h-3" />
                  {categorized.unknown.length}
                </span>
              )}
            </div>
          </div>

          {/* 规则提示 */}
          {(extractionRuleId || cleaningRuleId) && (
            <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
              <span>当前规则：</span>
              {extractionRuleName && (
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full">提取：{extractionRuleName}</span>
              )}
              {cleaningRuleName && (
                <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full">清洗：{cleaningRuleName}</span>
              )}
            </div>
          )}

          {/* 音频提示 */}
          {hasAudio && (
            <div className="flex gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 leading-relaxed">
                音频文件将以默认元数据导入（标题取自文件名，类型为「其他」）。如需补充参与人、时间等信息，可在导入后到沟通资产页面编辑。
              </p>
            </div>
          )}

          {/* 分类文件列表 */}
          <div className="space-y-3">
            {renderFileList('communication')}
            {renderFileList('document')}
            {renderFileList('structured')}
          </div>

          {/* 不支持的文件 */}
          {hasUnknown && (
            <div className="flex gap-2 p-3 bg-orange-50 border border-orange-100 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-orange-700 mb-1">
                  {categorized.unknown.length} 个文件类型不支持，将跳过
                </p>
                <p className="text-xs text-orange-600">
                  {categorized.unknown.slice(0, 5).map(f => (f.webkitRelativePath || f.name).split('/').pop()).join('、')}
                  {categorized.unknown.length > 5 && ` 等`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={importableCount === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importableCount > 0
              ? `开始导入 (${importableCount} 个文件)`
              : '没有可识别的文件'}
          </button>
        </div>
      </div>
    </div>
  )
}
