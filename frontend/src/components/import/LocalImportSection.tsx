import { useState, useCallback, useRef } from 'react'
import { Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ImportCategory } from './importUtils'
import type { AudioMetadata } from './ImportConfirmModal'
import CategoryCard from './CategoryCard'
import SmartDropZone from './SmartDropZone'
import ImportConfirmModal from './ImportConfirmModal'
import api from '../../lib/api'

// 每种分类对应的 accept 过滤
const CATEGORY_ACCEPT: Record<ImportCategory, string> = {
  communication: '.mp3,.wav,.m4a,.aac,.ogg,.flac',
  document: '.pdf,.doc,.docx,.md,.markdown,.txt,.ppt,.pptx',
  structured: '.xls,.xlsx,.csv,.tsv,.json,.xml,.sql',
  unknown: '*',
}

export default function LocalImportSection() {
  const [activeCategory, setActiveCategory] = useState<ImportCategory | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [recommendedCategory, setRecommendedCategory] = useState<ImportCategory>('document')
  // 当通过卡片上传时，锁定分类（不需要用户再选）
  const [lockedCategory, setLockedCategory] = useState<ImportCategory | null>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)

  // 处理文件检测（来自拖拽区）— 需要用户选择分类
  const handleFilesDetected = useCallback((files: File[], category: ImportCategory) => {
    setPendingFiles(files)
    setRecommendedCategory(category)
    setActiveCategory(category)
    setLockedCategory(null) // 拖拽上传不锁定分类
    setModalOpen(true)
  }, [])

  // 点击分类卡片 → 打开带过滤的文件选择器
  const handleCategoryClick = (category: ImportCategory) => {
    setActiveCategory(category)
    if (categoryInputRef.current) {
      categoryInputRef.current.accept = CATEGORY_ACCEPT[category]
      categoryInputRef.current.click()
    }
  }

  // 分类卡片选择文件后的回调 — 锁定分类，不需要用户再选
  const handleCategoryFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0 && activeCategory) {
      setPendingFiles(files)
      setRecommendedCategory(activeCategory)
      setLockedCategory(activeCategory) // 锁定为卡片的分类
      setModalOpen(true)
    }
    e.target.value = ''
  }

  // 根据分类选择上传接口
  const getUploadUrl = (category: ImportCategory): string => {
    if (category === 'structured') return '/structured-tables/import/upload'
    if (category === 'communication') return '/upload/communication'
    return '/upload/file'
  }

  // 执行上传（不含超时逻辑，纯上传）
  const doUpload = async (category: ImportCategory, files: File[], metadata?: AudioMetadata) => {
    const url = getUploadUrl(category)
    let successCount = 0
    let failCount = 0
    let lastError = ''

    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)

      // 沟通资产：附带用户填写的元数据
      if (category === 'communication' && metadata) {
        formData.append('metadata', JSON.stringify(metadata))
      }

      try {
        await api.post(url, formData)
        successCount++
      } catch (error: any) {
        const msg = error.response?.data?.detail || error.message || '未知错误'
        console.error(`Upload failed for ${file.name}:`, msg)
        lastError = msg
        failCount++
      }
    }

    return { successCount, failCount, lastError }
  }

  // 处理上传确认：5秒超时自动转后台
  const handleConfirmUpload = async (category: ImportCategory, files: File[], metadata?: AudioMetadata) => {
    let settled = false

    const uploadPromise = doUpload(category, files, metadata)

    // 5秒超时：关闭弹窗，后台继续跑
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true
        handleCloseModal()
        toast('上传时间较长，已转入后台运行', { icon: '⏳', duration: 4000 })
        // 后台继续等待结果并通知
        uploadPromise.then(({ successCount, failCount, lastError }) => {
          if (successCount > 0) toast.success(`后台上传完成：${successCount} 个文件成功`)
          if (failCount > 0) toast.error(`后台上传：${failCount} 个文件失败: ${lastError}`)
        })
      }
    }, 5000)

    const result = await uploadPromise
    clearTimeout(timeoutId)

    if (settled) return // 已经转后台了，不再重复提示

    const { successCount, failCount, lastError } = result

    if (successCount > 0) {
      toast.success(`成功上传 ${successCount} 个文件`)
    }
    if (failCount > 0) {
      toast.error(`${failCount} 个文件上传失败: ${lastError}`)
    }

    if (successCount === 0) {
      throw new Error('所有文件上传失败')
    }
  }

  // 关闭弹窗
  const handleCloseModal = () => {
    setModalOpen(false)
    setPendingFiles([])
    setActiveCategory(null)
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

      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-gray-600" />
          <h2 className="font-semibold text-gray-900">本地导入</h2>
        </div>
        <button type="button" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
          查看支持格式
        </button>
      </div>

      {/* 分类卡片 — 点击直接弹出文件选择器 */}
      <div className="space-y-3 mb-4">
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

      {/* 拖拽区域 */}
      <SmartDropZone
        onFilesDetected={handleFilesDetected}
        activeCategory={activeCategory}
      />

      {/* 确认弹窗 */}
      <ImportConfirmModal
        open={modalOpen}
        files={pendingFiles}
        recommendedCategory={recommendedCategory}
        lockedCategory={lockedCategory}
        onConfirm={handleConfirmUpload}
        onClose={handleCloseModal}
      />
    </div>
  )
}
