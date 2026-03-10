import { useState, useEffect } from 'react'
import { X, Upload, File, AudioWaveform, FileText, Table2, Loader2, Plus } from 'lucide-react'
import type { ImportCategory } from './importUtils'
import { CATEGORY_CONFIG, formatFileSize, getFileTypeLabel } from './importUtils'

/** 音频文件导入时用户可补充的元数据 */
export interface AudioMetadata {
  title?: string
  comm_type?: 'meeting' | 'phone' | 'interview' | 'other'
  participants?: string[]
  comm_time?: string
  context?: string
}

interface ImportConfirmModalProps {
  open: boolean
  files: File[]
  recommendedCategory: ImportCategory
  /** 当通过分类卡片上传时，锁定分类不显示选择器 */
  lockedCategory?: ImportCategory | null
  onConfirm: (category: ImportCategory, files: File[], metadata?: AudioMetadata) => Promise<void>
  onClose: () => void
}

const CATEGORY_OPTIONS: ImportCategory[] = ['communication', 'document', 'structured']

const CATEGORY_ICONS: Record<string, typeof AudioWaveform> = {
  communication: AudioWaveform,
  document: FileText,
  structured: Table2,
}

const COMM_TYPE_OPTIONS = [
  { value: 'meeting', label: '会议录音' },
  { value: 'phone', label: '电话录音' },
  { value: 'interview', label: '面谈记录' },
  { value: 'other', label: '其他' },
] as const

export default function ImportConfirmModal({
  open,
  files,
  recommendedCategory,
  lockedCategory,
  onConfirm,
  onClose,
}: ImportConfirmModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<ImportCategory>(recommendedCategory)
  // 当 lockedCategory 存在时，强制使用锁定的分类
  const effectiveCategory = lockedCategory || selectedCategory
  const [uploading, setUploading] = useState(false)

  // 音频元数据表单状态
  const [audioTitle, setAudioTitle] = useState('')
  const [audioCommType, setAudioCommType] = useState<AudioMetadata['comm_type']>('meeting')
  const [audioParticipants, setAudioParticipants] = useState<string[]>([])
  const [participantInput, setParticipantInput] = useState('')
  const [audioCommTime, setAudioCommTime] = useState('')
  const [audioContext, setAudioContext] = useState('')

  // 弹窗打开时重置表单
  useEffect(() => {
    if (open) {
      setAudioTitle('')
      setAudioCommType('meeting')
      setAudioParticipants([])
      setParticipantInput('')
      setAudioCommTime('')
      setAudioContext('')
    }
  }, [open])

  // 是否显示音频补充信息表单
  const showAudioForm = effectiveCategory === 'communication'

  if (!open) return null

  const addParticipant = () => {
    const name = participantInput.trim()
    if (name && !audioParticipants.includes(name)) {
      setAudioParticipants([...audioParticipants, name])
      setParticipantInput('')
    }
  }

  const removeParticipant = (name: string) => {
    setAudioParticipants(audioParticipants.filter(p => p !== name))
  }

  const handleParticipantKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addParticipant()
    }
  }

  const handleConfirm = async () => {
    setUploading(true)
    try {
      // 构建音频元数据（仅沟通资产时传递）
      const metadata: AudioMetadata | undefined = showAudioForm
        ? {
            title: audioTitle || undefined,
            comm_type: audioCommType,
            participants: audioParticipants.length > 0 ? audioParticipants : undefined,
            comm_time: audioCommTime || undefined,
            context: audioContext || undefined,
          }
        : undefined
      await onConfirm(effectiveCategory, files, metadata)
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

          {/* 分类选择 — 锁定时只显示标签，未锁定时显示选择器 */}
          {lockedCategory ? (
            <div className="mb-5 flex items-center gap-2">
              <p className="text-sm text-gray-600">归类至：</p>
              {(() => {
                const config = CATEGORY_CONFIG[lockedCategory]
                const IconComp = CATEGORY_ICONS[lockedCategory]
                return (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm font-medium">
                    <IconComp className="w-4 h-4" />
                    {config.categoryName}
                  </span>
                )
              })()}
            </div>
          ) : (
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
          )}

          {/* 音频补充信息表单 — 仅沟通资产时显示 */}
          {showAudioForm && (
            <div className="mb-5 border border-indigo-100 rounded-xl bg-indigo-50/30 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">
                补充信息
                <span className="font-normal text-gray-400 ml-1">（选填，提升解析质量）</span>
              </p>
              <div className="space-y-3">
                {/* 类型选择 */}
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 w-14 flex-shrink-0">类型</label>
                  <div className="flex gap-2 flex-wrap">
                    {COMM_TYPE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAudioCommType(opt.value)}
                        disabled={uploading}
                        className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                          audioCommType === opt.value
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 标题 */}
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 w-14 flex-shrink-0">标题</label>
                  <input
                    type="text"
                    value={audioTitle}
                    onChange={e => setAudioTitle(e.target.value)}
                    placeholder="如：产品需求评审会议"
                    disabled={uploading}
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
                  />
                </div>

                {/* 参与人 */}
                <div className="flex items-start gap-2">
                  <label className="text-sm text-gray-600 w-14 flex-shrink-0 mt-1.5">参与人</label>
                  <div className="flex-1">
                    <div className="flex gap-2 mb-1.5">
                      <input
                        type="text"
                        value={participantInput}
                        onChange={e => setParticipantInput(e.target.value)}
                        onKeyDown={handleParticipantKeyDown}
                        placeholder="输入姓名，回车添加"
                        disabled={uploading}
                        className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
                      />
                      <button
                        type="button"
                        onClick={addParticipant}
                        disabled={uploading || !participantInput.trim()}
                        title="添加参与人"
                        className="px-2 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        <Plus className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                    {audioParticipants.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {audioParticipants.map(name => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-sm bg-white border border-gray-200 rounded-lg text-gray-700"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() => removeParticipant(name)}
                              disabled={uploading}
                              title="移除"
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 时间 */}
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 w-14 flex-shrink-0">时间</label>
                  <input
                    type="datetime-local"
                    value={audioCommTime}
                    onChange={e => setAudioCommTime(e.target.value)}
                    disabled={uploading}
                    title="选择录音时间"
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
                  />
                </div>

                {/* 备注/背景 */}
                <div className="flex items-start gap-2">
                  <label className="text-sm text-gray-600 w-14 flex-shrink-0 mt-1.5">备注</label>
                  <textarea
                    value={audioContext}
                    onChange={e => setAudioContext(e.target.value)}
                    placeholder="补充背景信息，如：这是和客户A的Q2需求对接"
                    rows={2}
                    disabled={uploading}
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none resize-none"
                  />
                </div>
              </div>
            </div>
          )}

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