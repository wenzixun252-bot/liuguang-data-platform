import { useState, useCallback, useRef } from 'react'
import { Upload, FileUp } from 'lucide-react'
import type { ImportCategory } from './importUtils'
import { classifyFiles } from './importUtils'

interface SmartDropZoneProps {
  onFilesDetected: (files: File[], category: ImportCategory) => void
  activeCategory?: ImportCategory | null
}

type DropState = 'idle' | 'drag-hover' | 'analyzing'

export default function SmartDropZone({ onFilesDetected, activeCategory }: SmartDropZoneProps) {
  const [dropState, setDropState] = useState<DropState>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dropState !== 'drag-hover') {
      setDropState('drag-hover')
    }
  }, [dropState])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 只有当离开整个拖拽区时才重置状态
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDropState('idle')
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropState('analyzing')

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const result = classifyFiles(files)
      onFilesDetected(files, result.primaryCategory)
    }

    setDropState('idle')
  }, [onFilesDetected])

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      const result = classifyFiles(files)
      onFilesDetected(files, result.primaryCategory)
    }
    // 重置 input 以允许选择相同文件
    e.target.value = ''
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative cursor-pointer rounded-xl p-6 transition-all duration-200
        border-2 border-dashed
        ${dropState === 'drag-hover'
          ? 'border-indigo-400 bg-indigo-50/50'
          : 'border-gray-300 bg-[#FAFAF8] hover:border-gray-400'
        }
        ${dropState === 'analyzing' ? 'opacity-70 pointer-events-none' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.pdf,.doc,.docx,.md,.markdown,.txt,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.json,.xml,.sql"
      />

      <div className="flex flex-col items-center justify-center text-center">
        {dropState === 'drag-hover' ? (
          <>
            <FileUp className="w-10 h-10 text-indigo-500 mb-3 animate-bounce" />
            <p className="text-sm font-medium text-indigo-600">
              松开鼠标，开始上传
            </p>
          </>
        ) : dropState === 'analyzing' ? (
          <>
            <div className="w-10 h-10 mb-3 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">正在识别文件类型...</p>
          </>
        ) : (
          <>
            <Upload className="w-10 h-10 text-gray-400 mb-3" />
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-medium text-indigo-600">点击上传</span>
              <span className="text-gray-400"> 或拖拽文件到此处</span>
            </p>
            <p className="text-xs text-gray-400">
              系统会自动识别文件类型并推荐分类
            </p>
          </>
        )}
      </div>

      {/* 活跃分类指示器 */}
      {activeCategory && dropState === 'drag-hover' && (
        <div className="absolute -top-2 -right-2 px-2 py-1 bg-indigo-600 text-white text-xs rounded-full">
          归类至: {activeCategory === 'communication' ? '沟通记录' : activeCategory === 'document' ? '专业文档' : '结构化表格'}
        </div>
      )}
    </div>
  )
}