import { useEffect, useState } from 'react'
import { Sparkles, TableProperties } from 'lucide-react'
import { getExtractionRules } from '../lib/api'

interface ExtractionRule {
  id: number
  name: string
  sectors: string[]
  fields: { key: string; label: string; description: string }[]
  is_active: boolean
}

export default function ExtractionRuleSlicer({
  selectedRuleId,
  onSelect,
  onViewFields,
}: {
  selectedRuleId: number | null
  onSelect: (ruleId: number | null) => void
  onViewFields: (ruleId: number) => void
}) {
  const [rules, setRules] = useState<ExtractionRule[]>([])

  useEffect(() => {
    getExtractionRules()
      .then((data: ExtractionRule[]) => setRules(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  if (rules.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <Sparkles size={13} className="text-violet-400 shrink-0" />
      <span className="text-[11px] text-gray-400 shrink-0 mr-0.5">按提取规则筛选</span>
      <button
        onClick={() => onSelect(selectedRuleId === -999 ? null : -999)}
        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors border ${
          selectedRuleId === -999
            ? 'bg-violet-100 text-violet-700 border-violet-300'
            : 'bg-white text-gray-500 border-gray-200 hover:border-violet-200 hover:text-violet-600'
        }`}
      >
        无规则
      </button>
      {rules.map(r => {
        const active = selectedRuleId === r.id
        return (
          <button
            key={r.id}
            onClick={() => onSelect(active ? null : r.id)}
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors border ${
              active
                ? 'bg-violet-100 text-violet-700 border-violet-300'
                : 'bg-white text-gray-500 border-gray-200 hover:border-violet-200 hover:text-violet-600'
            }`}
          >
            {r.name}
            {r.fields.length > 0 && (
              <span className="ml-1 text-[10px] opacity-60">{r.fields.length}字段</span>
            )}
          </button>
        )
      })}
      {selectedRuleId && selectedRuleId !== -999 && (
        <button
          onClick={() => onViewFields(selectedRuleId)}
          className="ml-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-1"
        >
          <TableProperties size={11} />
          字段视图
        </button>
      )}
      {selectedRuleId && (
        <button
          onClick={() => onSelect(null)}
          className="text-[10px] text-gray-400 hover:text-gray-600 ml-1"
        >
          清除
        </button>
      )}
    </div>
  )
}
