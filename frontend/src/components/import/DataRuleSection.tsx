import { useState, lazy, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Sparkles, Trash2, Plus, Edit3, Zap, Check, Lock, Eye } from 'lucide-react'
import { getExtractionRules, deleteExtractionRule, getCleaningRules, deleteCleaningRule } from '../../lib/api'
import toast from 'react-hot-toast'

const ExtractionRuleEditor = lazy(() => import('./ExtractionRuleEditor'))
const CleaningRuleEditor = lazy(() => import('./CleaningRuleEditor'))

interface DataRuleSectionProps {
  onRulesChange?: () => void
  activeExtractionRuleId: number | null
  activeCleaningRuleId: number | null
  onExtractionRuleChange: (id: number | null) => void
  onCleaningRuleChange: (id: number | null) => void
}

export default function DataRuleSection({ onRulesChange, activeExtractionRuleId, activeCleaningRuleId, onExtractionRuleChange, onCleaningRuleChange }: DataRuleSectionProps) {
  const [editingExtractionRule, setEditingExtractionRule] = useState<any>(null)
  const [showExtractionEditor, setShowExtractionEditor] = useState(false)
  const [editingCleaningRule, setEditingCleaningRule] = useState<any>(null)
  const [showCleaningEditor, setShowCleaningEditor] = useState(false)
  const queryClient = useQueryClient()

  const { data: extractionRules = [] } = useQuery({
    queryKey: ['extraction-rules'],
    queryFn: getExtractionRules,
  })
  const { data: cleaningRules = [] } = useQuery({
    queryKey: ['cleaning-rules'],
    queryFn: getCleaningRules,
  })

  const deleteExtraction = useMutation({
    mutationFn: deleteExtractionRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extraction-rules'] })
      toast.success('规则已删除')
      onRulesChange?.()
    },
  })
  const deleteCleaning = useMutation({
    mutationFn: deleteCleaningRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaning-rules'] })
      toast.success('规则已删除')
      onRulesChange?.()
    },
  })

  const sectorColors: Record<string, string> = {
    energy: 'bg-orange-100 text-orange-700',
    urban: 'bg-green-100 text-green-700',
    npa: 'bg-red-100 text-red-700',
    other: 'bg-purple-100 text-purple-700',
  }
  const sectorLabels: Record<string, string> = {
    energy: '能源',
    urban: '城乡',
    npa: '不良资产',
    other: '其他',
  }

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl p-5">
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-5 h-5 text-indigo-600" />
        <h3 className="font-semibold text-gray-900">数据处理规则</h3>
        <span className="text-sm text-gray-500">定义导入数据的自动提取和清洗方式</span>
      </div>

      {/* 左右并列布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左：提取规则 */}
        <div className="bg-white/70 rounded-xl border border-indigo-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-semibold text-gray-800">提取规则</span>
            <span className="text-xs text-gray-400">从文档中提取结构化字段</span>
            <span className="ml-auto text-xs text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">本地文档 · 飞书文档（含会议文档） · 会议记录表 · 本地表格</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {extractionRules.filter((r: any) => r.is_builtin).map((rule: any) => {
              const isActive = activeExtractionRuleId === rule.id
              return (
                <div
                  key={rule.id}
                  onClick={() => onExtractionRuleChange(isActive ? null : rule.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm group cursor-pointer transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-400 ring-2 ring-indigo-100 shadow-sm'
                      : 'bg-gradient-to-r from-indigo-50/50 to-purple-50/50 border border-indigo-200 hover:border-indigo-300'
                  }`}
                >
                  {isActive ? <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" /> : <Lock className="w-3 h-3 text-indigo-400 shrink-0" />}
                  <span className={`font-medium ${isActive ? 'text-indigo-700' : 'text-gray-800'}`}>{rule.name}</span>
                  <span className="text-gray-400 text-xs">{rule.fields?.length || 0}字段</span>
                  <button type="button" title="查看规则详情" onClick={(e) => { e.stopPropagation(); setEditingExtractionRule(rule); setShowExtractionEditor(true) }} className="opacity-0 group-hover:opacity-100 text-indigo-400 hover:text-indigo-600 transition-all"><Eye className="w-3.5 h-3.5" /></button>
                </div>
              )
            })}
            {extractionRules.filter((r: any) => !r.is_builtin).map((rule: any) => {
              const isActive = activeExtractionRuleId === rule.id
              return (
                <div
                  key={rule.id}
                  onClick={() => onExtractionRuleChange(isActive ? null : rule.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm group cursor-pointer transition-all ${
                    isActive
                      ? 'bg-indigo-50 border-2 border-indigo-400 ring-2 ring-indigo-100 shadow-sm'
                      : 'bg-white border border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  {isActive && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                  <span className={`font-medium ${isActive ? 'text-indigo-700' : 'text-gray-800'}`}>{rule.name}</span>
                  {rule.sectors?.map((s: string) => (
                    <span key={s} className={`px-1.5 py-0.5 rounded text-xs ${sectorColors[s] || 'bg-gray-100 text-gray-600'}`}>
                      {sectorLabels[s] || s}
                    </span>
                  ))}
                  <span className="text-gray-400 text-xs">{rule.fields?.length || 0}字段</span>
                  <button type="button" title="编辑规则" onClick={(e) => { e.stopPropagation(); setEditingExtractionRule(rule); setShowExtractionEditor(true) }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 transition-all"><Edit3 className="w-3.5 h-3.5" /></button>
                  <button type="button" title="删除规则" onClick={(e) => { e.stopPropagation(); if(confirm('确定删除？')) { deleteExtraction.mutate(rule.id); if (isActive) onExtractionRuleChange(null) } }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => { setEditingExtractionRule(null); setShowExtractionEditor(true) }}
              className="flex items-center gap-1 bg-white rounded-lg border-2 border-dashed border-indigo-300 px-3 py-2 text-sm text-indigo-600 font-medium hover:bg-indigo-50 transition-colors"
            >
              <Plus className="w-4 h-4" />新建提取规则
            </button>
          </div>
        </div>

        {/* 右：清洗规则 */}
        <div className="bg-white/70 rounded-xl border border-purple-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-semibold text-gray-800">清洗规则</span>
            <span className="text-xs text-gray-400">导入后自动清洗和标准化</span>
            <span className="ml-auto text-xs text-purple-400 bg-purple-50 px-2 py-0.5 rounded-full">本地表格 · 飞书表格 · 飞书多维表格</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {cleaningRules.filter((r: any) => r.is_builtin).map((rule: any) => {
              const opts = rule.options || {}
              const enabledCount = Object.values(opts).filter(v => v === true).length
              const isActive = activeCleaningRuleId === rule.id
              return (
                <div
                  key={rule.id}
                  onClick={() => onCleaningRuleChange(isActive ? null : rule.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm group cursor-pointer transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-400 ring-2 ring-purple-100 shadow-sm'
                      : 'bg-gradient-to-r from-purple-50/50 to-pink-50/50 border border-purple-200 hover:border-purple-300'
                  }`}
                >
                  {isActive ? <Check className="w-3.5 h-3.5 text-purple-600 shrink-0" /> : <Lock className="w-3 h-3 text-purple-400 shrink-0" />}
                  <span className={`font-medium ${isActive ? 'text-purple-700' : 'text-gray-800'}`}>{rule.name}</span>
                  <span className="text-gray-400 text-xs">{enabledCount}项开启</span>
                  <button type="button" title="查看规则详情" onClick={(e) => { e.stopPropagation(); setEditingCleaningRule(rule); setShowCleaningEditor(true) }} className="opacity-0 group-hover:opacity-100 text-purple-400 hover:text-purple-600 transition-all"><Eye className="w-3.5 h-3.5" /></button>
                </div>
              )
            })}
            {cleaningRules.filter((r: any) => !r.is_builtin).map((rule: any) => {
              const opts = rule.options || {}
              const enabledCount = Object.values(opts).filter(v => v === true).length
              const isActive = activeCleaningRuleId === rule.id
              return (
                <div
                  key={rule.id}
                  onClick={() => onCleaningRuleChange(isActive ? null : rule.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm group cursor-pointer transition-all ${
                    isActive
                      ? 'bg-purple-50 border-2 border-purple-400 ring-2 ring-purple-100 shadow-sm'
                      : 'bg-white border border-gray-200 hover:border-purple-300'
                  }`}
                >
                  {isActive && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
                  <span className={`font-medium ${isActive ? 'text-purple-700' : 'text-gray-800'}`}>{rule.name}</span>
                  <span className="text-gray-400 text-xs">{enabledCount}项开启</span>
                  {rule.field_hint && <span className="text-purple-500 text-xs">有描述</span>}
                  <button type="button" title="编辑规则" onClick={(e) => { e.stopPropagation(); setEditingCleaningRule(rule); setShowCleaningEditor(true) }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 transition-all"><Edit3 className="w-3.5 h-3.5" /></button>
                  <button type="button" title="删除规则" onClick={(e) => { e.stopPropagation(); if(confirm('确定删除？')) { deleteCleaning.mutate(rule.id); if (isActive) onCleaningRuleChange(null) } }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => { setEditingCleaningRule(null); setShowCleaningEditor(true) }}
              className="flex items-center gap-1 bg-white rounded-lg border-2 border-dashed border-purple-300 px-3 py-2 text-sm text-purple-600 font-medium hover:bg-purple-50 transition-colors"
            >
              <Plus className="w-4 h-4" />新建清洗规则
            </button>
          </div>
        </div>
      </div>

      {/* 编辑弹窗 */}
      {showExtractionEditor && (
        <Suspense fallback={null}>
          <ExtractionRuleEditor
            rule={editingExtractionRule}
            onClose={() => setShowExtractionEditor(false)}
            onSaved={() => {
              setShowExtractionEditor(false)
              queryClient.invalidateQueries({ queryKey: ['extraction-rules'] })
              onRulesChange?.()
            }}
          />
        </Suspense>
      )}
      {showCleaningEditor && (
        <Suspense fallback={null}>
          <CleaningRuleEditor
            rule={editingCleaningRule}
            onClose={() => setShowCleaningEditor(false)}
            onSaved={() => {
              setShowCleaningEditor(false)
              queryClient.invalidateQueries({ queryKey: ['cleaning-rules'] })
              onRulesChange?.()
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
