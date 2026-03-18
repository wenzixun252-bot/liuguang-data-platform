import { useState, useCallback, useRef } from 'react'
import { Upload, FolderOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ImportCategory } from './importUtils'
import { filterSystemFiles } from './importUtils'
import CategoryCard from './CategoryCard'
import FolderImportPreviewModal from './FolderImportPreviewModal'
import { useTaskProgress } from '../../hooks/useTaskProgress'
import api from '../../lib/api'

declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string
    directory?: string
  }
}

// 每种分类对应的 accept 过滤
const CATEGORY_ACCEPT: Record<ImportCategory, string> = {
  communication: '.mp3,.wav,.m4a,.aac,.ogg,.flac',
  document: '.pdf,.doc,.docx,.md,.markdown,.txt,.ppt,.pptx,.png,.jpg,.jpeg',
  structured: '.xls,.xlsx,.csv,.tsv,.json,.xml,.sql',
  unknown: '*',
}

// 分类中文名
const CATEGORY_LABELS: Record<ImportCategory, string> = {
  communication: '沟通数据导入',
  document: '文档数据导入',
  structured: '表格数据导入',
  unknown: '文件导入',
}

interface LocalImportSectionProps {
  extractionRuleId: number | null
  cleaningRuleId: number | null
  extractionRuleName?: string
  cleaningRuleName?: string
}

// 检测浏览器是否支持 webkitdirectory
const supportsWebkitDirectory = typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input')

export default function LocalImportSection({ extractionRuleId, cleaningRuleId, extractionRuleName, cleaningRuleName }: LocalImportSectionProps) {
  const [activeCategory, setActiveCategory] = useState<ImportCategory | null>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [showFolderPreview, setShowFolderPreview] = useState(false)
  const { addTask, updateTask } = useTaskProgress()

  // 根据分类选择上传接口
  const getUploadUrl = (category: ImportCategory): string => {
    if (category === 'structured') return '/structured-tables/import/upload'
    if (category === 'communication') return '/upload/communication'
    return '/upload/file'
  }

  // 执行后台上传（使用全局任务进度 context，切换页面不丢失）
  const startBackgroundUpload = useCallback(async (category: ImportCategory, files: File[]) => {
    const taskId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const label = `${CATEGORY_LABELS[category]} ${files.length} 个文件`

    addTask(taskId, label)
    toast(`${files.length} 个文件已开始后台导入`, { icon: '📤', duration: 2000 })

    const url = getUploadUrl(category)
    let successCount = 0
    let failCount = 0
    let lastError = ''

    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)

      try {
        const params: Record<string, number> = {}
        if (category === 'structured') {
          if (cleaningRuleId) params.cleaning_rule_id = cleaningRuleId
        }
        if (extractionRuleId) params.extraction_rule_id = extractionRuleId
        if (category === 'communication') {
          formData.append('metadata', JSON.stringify({
            title: file.name.replace(/\.\w+$/, ''),
            comm_type: 'other',
          }))
        }
        await api.post(url, formData, { params })
        successCount++
      } catch (error: any) {
        const msg = error.response?.data?.detail || error.message || '未知错误'
        console.error(`Upload failed for ${file.name}:`, msg)
        lastError = msg
        failCount++
      }

      const processed = successCount + failCount
      const progress = Math.round((processed / files.length) * 100)
      updateTask(taskId, { progress, message: `${processed}/${files.length}` })
    }

    const finalStatus = failCount === files.length ? 'error' : 'done'
    const finalMessage = `成功 ${successCount} · 失败 ${failCount}`
    updateTask(taskId, {
      status: finalStatus as 'done' | 'error',
      progress: 100,
      message: finalMessage,
      ...(failCount > 0 && lastError ? { errorDetail: lastError } : {}),
    })

    if (successCount > 0) toast.success(`${successCount} 个文件导入成功`)
    if (failCount > 0) toast.error(`${failCount} 个文件导入失败: ${lastError}`)
  }, [extractionRuleId, cleaningRuleId, addTask, updateTask])

  // 点击分类卡片 → 打开带过滤的文件选择器
  const handleCategoryClick = (category: ImportCategory) => {
    setActiveCategory(category)
    if (categoryInputRef.current) {
      categoryInputRef.current.accept = CATEGORY_ACCEPT[category]
      categoryInputRef.current.click()
    }
  }

  // 分类卡片选择文件后 → 直接后台上传
  const handleCategoryFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0 && activeCategory) {
      startBackgroundUpload(activeCategory, files)
    }
    e.target.value = ''
    setActiveCategory(null)
  }

  // 文件夹选择处理
  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(e.target.files || [])
    const filtered = filterSystemFiles(rawFiles)
    if (filtered.length === 0) {
      toast('文件夹为空或没有可导入的文件', { icon: '📂', duration: 3000 })
    } else {
      setFolderFiles(filtered)
      setShowFolderPreview(true)
    }
    e.target.value = ''
  }

  // 文件夹预览确认
  const handleFolderConfirm = (categorizedFiles: Record<ImportCategory, File[]>) => {
    setShowFolderPreview(false)
    setFolderFiles([])
    const categories: ImportCategory[] = ['communication', 'document', 'structured']
    for (const cat of categories) {
      if (categorizedFiles[cat].length > 0) {
        startBackgroundUpload(cat, categorizedFiles[cat])
      }
    }
  }

  return (
    <div className="bg-[#F7F6F3] rounded-2xl p-5 h-full">
      {/* 隐藏的分类文件选择器 */}
      <input
        ref={categoryInputRef}
        type="file"
        multiple
        className="hidden"
        title="选择文件"
        onChange={handleCategoryFileSelect}
      />
      {/* 隐藏的文件夹选择器 */}
      {supportsWebkitDirectory && (
        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          title="选择文件夹"
          onChange={handleFolderSelect}
        />
      )}

      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-gray-600" />
          <h2 className="font-semibold text-gray-900">本地导入</h2>
        </div>
      </div>

      {/* 分类卡片 — 点击直接弹出文件选择器 */}
      <div className="space-y-2">
        <CategoryCard
          category="communication"
          isActive={activeCategory === 'communication'}
          onClick={() => handleCategoryClick('communication')}
        />
        <CategoryCard
          category="document"
          isActive={activeCategory === 'document'}
          onClick={() => handleCategoryClick('document')}
        />
        <CategoryCard
          category="structured"
          isActive={activeCategory === 'structured'}
          onClick={() => handleCategoryClick('structured')}
        />
      </div>

      {/* 文件夹导入 */}
      {supportsWebkitDirectory && (
        <>
          <div className="flex items-center gap-3 my-2.5">
            <div className="flex-1 border-t border-gray-300" />
            <span className="text-xs text-gray-400">或者</span>
            <div className="flex-1 border-t border-gray-300" />
          </div>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-2 bg-white border-2 border-dashed border-gray-300 rounded-xl hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors group"
          >
            <FolderOpen className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition-colors" />
            <div className="text-left">
              <p className="text-sm font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">整个文件夹导入</p>
              <p className="text-xs text-gray-400">自动识别文件类型，批量归档</p>
            </div>
          </button>
        </>
      )}

      {/* 文件夹预览弹窗 */}
      <FolderImportPreviewModal
        open={showFolderPreview}
        files={folderFiles}
        extractionRuleId={extractionRuleId}
        cleaningRuleId={cleaningRuleId}
        extractionRuleName={extractionRuleName}
        cleaningRuleName={cleaningRuleName}
        onConfirm={handleFolderConfirm}
        onClose={() => { setShowFolderPreview(false); setFolderFiles([]) }}
      />

    </div>
  )
}
