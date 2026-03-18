import { useState, useCallback, useRef } from 'react'
import { Upload, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, Trash2, File, FolderOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ImportCategory } from './importUtils'
import { formatFileSize, filterSystemFiles } from './importUtils'
import CategoryCard from './CategoryCard'
import FolderImportPreviewModal from './FolderImportPreviewModal'
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
  communication: '沟通资产导入',
  document: '文档资产导入',
  structured: '表格资产导入',
  unknown: '文件导入',
}

// 本地上传任务
interface LocalUploadTask {
  id: string
  category: ImportCategory
  files: { name: string; size: number }[]
  status: 'running' | 'done' | 'error'
  successCount: number
  failCount: number
  errorMessage: string
  createdAt: number
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
  const [uploadTasks, setUploadTasks] = useState<LocalUploadTask[]>([])
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [showFolderPreview, setShowFolderPreview] = useState(false)

  // 根据分类选择上传接口
  const getUploadUrl = (category: ImportCategory): string => {
    if (category === 'structured') return '/structured-tables/import/upload'
    if (category === 'communication') return '/upload/communication'
    return '/upload/file'
  }

  // 执行后台上传
  const startBackgroundUpload = useCallback(async (category: ImportCategory, files: File[]) => {
    const taskId = `local-${Date.now()}`
    const fileInfos = files.map(f => ({ name: f.name, size: f.size }))

    // 立即添加任务到列表
    setUploadTasks(prev => [{
      id: taskId,
      category,
      files: fileInfos,
      status: 'running',
      successCount: 0,
      failCount: 0,
      errorMessage: '',
      createdAt: Date.now(),
    }, ...prev])

    toast(`${files.length} 个文件已开始后台导入`, { icon: '📤', duration: 2000 })

    // 后台逐个上传
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
        } else {
          if (extractionRuleId) params.extraction_rule_id = extractionRuleId
        }
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

      // 实时更新进度
      setUploadTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, successCount, failCount, errorMessage: lastError } : t
      ))
    }

    // 更新最终状态
    const finalStatus = failCount === files.length ? 'error' : 'done'
    setUploadTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: finalStatus as 'done' | 'error', successCount, failCount, errorMessage: lastError } : t
    ))

    // Toast 通知结果
    if (successCount > 0) toast.success(`${successCount} 个文件导入成功`)
    if (failCount > 0) toast.error(`${failCount} 个文件导入失败: ${lastError}`)
  }, [extractionRuleId, cleaningRuleId])

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

  // 删除任务记录
  const removeTask = (taskId: string) => {
    setUploadTasks(prev => prev.filter(t => t.id !== taskId))
  }

  // 统计
  const runningTasks = uploadTasks.filter(t => t.status === 'running')
  const finishedTasks = uploadTasks.filter(t => t.status !== 'running')

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
      <div className="space-y-3">
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
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 border-t border-gray-300" />
            <span className="text-xs text-gray-400">或者</span>
            <div className="flex-1 border-t border-gray-300" />
          </div>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-3 bg-white border-2 border-dashed border-gray-300 rounded-xl hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors group"
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

      {/* 导入任务列表 — 卡片下方 */}
      {uploadTasks.length > 0 && (
        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-800">导入任务</h3>
            {runningTasks.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-blue-600">
                <Loader2 className="w-3 h-3 animate-spin" />
                {runningTasks.length} 个任务运行中
              </span>
            )}
            {finishedTasks.length > 0 && runningTasks.length === 0 && (
              <button
                type="button"
                onClick={() => setUploadTasks(prev => prev.filter(t => t.status === 'running'))}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                清除已完成
              </button>
            )}
          </div>
          <div className="space-y-2">
            {uploadTasks.map(task => {
              const isExpanded = expandedTaskId === task.id
              const totalFiles = task.files.length
              const processed = task.successCount + task.failCount
              const isFinished = task.status !== 'running'

              return (
                <div key={task.id} className="rounded-lg bg-gray-50 text-sm overflow-hidden">
                  {/* 任务摘要行 */}
                  <div
                    className="flex items-center gap-3 p-2 cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    )}
                    {task.status === 'running' ? (
                      <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                    ) : task.status === 'done' ? (
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-700">
                          {CATEGORY_LABELS[task.category]}
                        </span>
                        <span className="text-xs text-gray-400">
                          {totalFiles} 个文件
                        </span>
                      </div>
                      {task.status === 'running' && (
                        <p className="text-xs text-blue-500 mt-0.5">
                          已处理 {processed}/{totalFiles}
                        </p>
                      )}
                      {isFinished && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          成功 {task.successCount} · 失败 {task.failCount}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {isFinished
                        ? new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                        : '进行中...'}
                    </span>
                  </div>

                  {/* 展开的详情 */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-gray-200 bg-white">
                      {/* 文件列表 */}
                      <div className="mb-2">
                        <p className="text-xs font-medium text-gray-500 mb-1.5">文件列表</p>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {task.files.map((file, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs text-gray-600 py-0.5">
                              <File className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span className="truncate flex-1">{file.name}</span>
                              <span className="text-gray-400 shrink-0">{formatFileSize(file.size)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 错误信息 */}
                      {task.errorMessage && (
                        <div className="mb-2 p-2 rounded-lg bg-red-50 border border-red-100">
                          <p className="text-xs text-red-600 break-all">{task.errorMessage}</p>
                        </div>
                      )}

                      {/* 删除按钮 */}
                      {isFinished && (
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeTask(task.id) }}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            删除记录
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
