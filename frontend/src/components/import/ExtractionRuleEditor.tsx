import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { X, Plus, Trash2, Sparkles, Lock } from 'lucide-react'
import { createExtractionRule, updateExtractionRule } from '../../lib/api'
import toast from 'react-hot-toast'

interface ExtractionRuleEditorProps {
  rule: any | null  // null = 新建, 有值 = 编辑
  onClose: () => void
  onSaved: () => void
}

interface FieldItem {
  key: string
  label: string
  description: string
}

export default function ExtractionRuleEditor({ rule, onClose, onSaved }: ExtractionRuleEditorProps) {
  const isEditing = !!rule
  const isBuiltin = !!rule?.is_builtin

  const [name, setName] = useState(rule?.name || '')
  const [fields, setFields] = useState<FieldItem[]>(() => {
    if (rule?.fields?.length) {
      return rule.fields.map((f: any) => ({
        key: f.key || `field_${Date.now()}_${Math.random()}`,
        label: f.label || '',
        description: f.description || '',
      }))
    }
    return []
  })
  const [promptHint, setPromptHint] = useState(rule?.prompt_hint || '')

  const addField = () => {
    setFields(prev => [...prev, { key: `field_${Date.now()}`, label: '', description: '' }])
  }
  const updateField = (index: number, updates: Partial<FieldItem>) => {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, ...updates } : f))
  }
  const removeField = (index: number) => {
    setFields(prev => prev.filter((_, i) => i !== index))
  }

  const saveMutation = useMutation({
    mutationFn: (data: any) => {
      if (isEditing) return updateExtractionRule(rule.id, data)
      return createExtractionRule(data)
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
    const validFields = fields.filter(f => f.label.trim())
    if (validFields.length === 0) { toast.error('请至少添加一个提取字段'); return }
    saveMutation.mutate({
      name: name.trim(),
      sectors: [],
      fields: validFields,
      prompt_hint: promptHint.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {isBuiltin ? <Lock className="w-5 h-5 text-indigo-400" /> : <Sparkles className="w-5 h-5 text-indigo-600" />}
            <h2 className="text-xl font-semibold text-gray-900">
              {isBuiltin ? '查看内置提取规则' : isEditing ? '编辑提取规则' : '新建提取规则'}
            </h2>
          </div>
          <button type="button" title="关闭" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 规则名称 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">规则名称</label>
          {isBuiltin ? (
            <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800">{name}</div>
          ) : (
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：会议纪要提取"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none transition-all"
            />
          )}
        </div>

        {/* 字段列表 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            提取字段 <span className="text-gray-400 font-normal">({fields.length} 个)</span>
          </label>

          {fields.length === 0 && !isBuiltin && (
            <div className="text-center py-6 text-sm text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              暂无字段，点击下方添加
            </div>
          )}

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {fields.map((field, index) => (
              <div
                key={field.key + index}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  isBuiltin ? 'border-gray-100 bg-gray-50' : 'border-gray-200 bg-white hover:border-indigo-200'
                }`}
              >
                <div className="flex-1 min-w-0 space-y-1">
                  {isBuiltin ? (
                    <>
                      <div className="text-sm font-medium text-gray-800">{field.label}</div>
                      {field.description && <div className="text-xs text-gray-500">{field.description}</div>}
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={field.label}
                        onChange={e => updateField(index, { label: e.target.value })}
                        placeholder="字段名称"
                        className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm font-medium placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:bg-white outline-none transition-all"
                      />
                      <input
                        type="text"
                        value={field.description}
                        onChange={e => updateField(index, { description: e.target.value })}
                        placeholder="字段描述（可选，帮助 AI 更准确提取）"
                        className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:bg-white outline-none transition-all"
                      />
                    </>
                  )}
                </div>
                {!isBuiltin && (
                  <button type="button" title="删除字段" onClick={() => removeField(index)} className="text-gray-300 hover:text-red-500 transition-colors mt-1.5">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {!isBuiltin && (
            <button type="button" onClick={addField} className="mt-2 flex items-center gap-1 text-sm text-indigo-600 font-medium hover:text-indigo-700 transition-colors">
              <Plus className="w-4 h-4" />添加字段
            </button>
          )}
        </div>

        {/* 提取提示 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">提取提示{!isBuiltin && '（可选）'}</label>
          {isBuiltin ? (
            <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 whitespace-pre-wrap">{promptHint || '无'}</div>
          ) : (
            <textarea
              value={promptHint}
              onChange={e => setPromptHint(e.target.value)}
              placeholder="输入额外的提取提示，引导 AI 更准确地提取内容..."
              rows={3}
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
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                取消
              </button>
              <button
                type="button"
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
