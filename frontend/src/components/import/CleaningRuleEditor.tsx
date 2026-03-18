import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { X, Zap, Lock } from 'lucide-react'
import { createCleaningRule, updateCleaningRule } from '../../lib/api'
import toast from 'react-hot-toast'

interface CleaningRuleEditorProps {
  rule: any | null  // null = 新建, 有值 = 编辑
  onClose: () => void
  onSaved: () => void
}

interface CleaningOptions {
  dedup: boolean
  drop_empty_rows: boolean
  empty_threshold: number
  normalize_dates: boolean
  normalize_numbers: boolean
  trim_whitespace: boolean
  llm_field_merge: boolean
  llm_field_clean: boolean
}

const CLEANING_OPTION_LABELS: { key: keyof Omit<CleaningOptions, 'empty_threshold'>; label: string; description: string }[] = [
  { key: 'dedup', label: '去重', description: '移除完全重复的行记录' },
  { key: 'drop_empty_rows', label: '空行处理', description: '移除空值比例超过阈值的行' },
  { key: 'trim_whitespace', label: '空白处理', description: '去除多余空格、换行符' },
  { key: 'normalize_dates', label: '日期标准化', description: '统一日期格式为 YYYY-MM-DD' },
  { key: 'normalize_numbers', label: '数值标准化', description: '统一数值格式（去除千分位等）' },
  { key: 'llm_field_merge', label: 'AI 自动合并字段', description: '使用 AI 智能合并含义相同的列' },
  { key: 'llm_field_clean', label: 'AI 自动清洗字段', description: '使用 AI 修正错别字、统一表述' },
]

const DEFAULT_OPTIONS: CleaningOptions = {
  dedup: true,
  drop_empty_rows: true,
  empty_threshold: 0.5,
  trim_whitespace: true,
  normalize_dates: false,
  normalize_numbers: false,
  llm_field_merge: false,
  llm_field_clean: false,
}

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${disabled ? 'cursor-default' : ''} ${on ? 'bg-indigo-600' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function CleaningRuleEditor({ rule, onClose, onSaved }: CleaningRuleEditorProps) {
  const isEditing = !!rule
  const isBuiltin = !!rule?.is_builtin

  const [name, setName] = useState(rule?.name || '')
  const [options, setOptions] = useState<CleaningOptions>(() => ({
    ...DEFAULT_OPTIONS,
    ...(rule?.options || {}),
  }))
  const [fieldHint, setFieldHint] = useState(rule?.field_hint || '')

  const toggleOption = (key: keyof CleaningOptions) => {
    if (isBuiltin) return
    setOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const saveMutation = useMutation({
    mutationFn: (data: any) => {
      if (isEditing) return updateCleaningRule(rule.id, data)
      return createCleaningRule(data)
    },
    onSuccess: () => {
      toast.success(isEditing ? '规则已更新' : '规则已创建')
      onSaved()
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || '保存失败')
    },
  })

  const handleSave = () => {
    if (!name.trim()) { toast.error('请输入规则名称'); return }
    saveMutation.mutate({
      name: name.trim(),
      options: {
        dedup: options.dedup,
        drop_empty_rows: options.drop_empty_rows,
        empty_threshold: options.empty_threshold,
        normalize_dates: options.normalize_dates,
        normalize_numbers: options.normalize_numbers,
        trim_whitespace: options.trim_whitespace,
        llm_field_merge: options.llm_field_merge,
        llm_field_clean: options.llm_field_clean,
      },
      field_hint: fieldHint.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {isBuiltin ? <Lock className="w-5 h-5 text-purple-400" /> : <Zap className="w-5 h-5 text-indigo-600" />}
            <h2 className="text-xl font-semibold text-gray-900">
              {isBuiltin ? '查看内置清洗规则' : isEditing ? '编辑清洗规则' : '新建清洗规则'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 规则名称 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">规则名称</label>
          {isBuiltin ? (
            <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800">{name}</div>
          ) : (
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：标准清洗流程"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none transition-all"
            />
          )}
        </div>

        {/* 清洗选项 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-3">清洗选项</label>
          <div className="space-y-3">
            {CLEANING_OPTION_LABELS.map(({ key, label, description }) => (
              <div key={key}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{label}</div>
                    <p className="text-xs text-gray-500">{description}</p>
                  </div>
                  <Toggle on={!!options[key]} onToggle={() => toggleOption(key)} disabled={isBuiltin} />
                </div>

                {key === 'drop_empty_rows' && options.drop_empty_rows && (
                  <div className="mt-2 ml-1 flex items-center gap-3">
                    <span className="text-xs text-gray-500 shrink-0">空值阈值</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={options.empty_threshold}
                      onChange={e => setOptions(prev => ({ ...prev, empty_threshold: parseFloat(e.target.value) }))}
                      disabled={isBuiltin}
                      className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none accent-indigo-600"
                    />
                    <span className="text-xs text-indigo-600 font-medium w-8 text-right">{(options.empty_threshold * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 字段处理描述 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">字段处理描述{!isBuiltin && '（可选）'}</label>
          {isBuiltin ? (
            <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 whitespace-pre-wrap">{fieldHint || '无'}</div>
          ) : (
            <textarea
              value={fieldHint}
              onChange={e => setFieldHint(e.target.value)}
              placeholder={"描述具体的字段处理需求，例如：\n- 将「金额」列统一为万元\n- 合并「省」「市」「区」为「地区」\n- 日期列只保留年月"}
              rows={4}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none transition-all resize-none"
            />
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-3">
          {isBuiltin ? (
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
              关闭
            </button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? '保存中...' : isEditing ? '更新规则' : '创建规则'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
