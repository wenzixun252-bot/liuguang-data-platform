import { useState, useCallback } from 'react'
import { Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ImportCategory } from './importUtils'
import CategoryCard from './CategoryCard'
import SmartDropZone from './SmartDropZone'
import ImportConfirmModal from './ImportConfirmModal'
import api from '../../lib/api'

export default function LocalImportSection() {
  const [activeCategory, setActiveCategory] = useState<ImportCategory | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [recommendedCategory, setRecommendedCategory] = useState<ImportCategory>('document')

  // 处理文件检测
  const handleFilesDetected = useCallback((files: File[], category: ImportCategory) => {
    setPendingFiles(files)
    setRecommendedCategory(category)
    setActiveCategory(category)
    setModalOpen(true)
  }, [])

  // 处理上传确认
  const handleConfirmUpload = async (_category: ImportCategory, files: File[]) => {
    let successCount = 0
    let failCount = 0

    // 逐个上传文件（后端API只支持单文件上传）
    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)

      try {
        await api.post('/api/upload/file', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        })
        successCount++
      } catch (error) {
        console.error(`Upload failed for ${file.name}:`, error)
        failCount++
      }
    }

    if (successCount > 0) {
      toast.success(`成功上传 ${successCount} 个文件`)
    }
    if (failCount > 0) {
      toast.error(`${failCount} 个文件上传失败`)
    }

    // 如果全部失败，抛出错误让弹窗保持打开
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
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-gray-600" />
          <h2 className="font-semibold text-gray-900">本地导入</h2>
        </div>
        <button className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
          查看支持格式
        </button>
      </div>

      {/* 分类卡片 */}
      <div className="space-y-3 mb-4">
        <CategoryCard
          category="communication"
          isActive={activeCategory === 'communication'}
          onClick={() => setActiveCategory('communication')}
        />
        <CategoryCard
          category="document"
          isActive={activeCategory === 'document'}
          onClick={() => setActiveCategory('document')}
        />
        <CategoryCard
          category="structured"
          isActive={activeCategory === 'structured'}
          onClick={() => setActiveCategory('structured')}
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
        onConfirm={handleConfirmUpload}
        onClose={handleCloseModal}
      />
    </div>
  )
}