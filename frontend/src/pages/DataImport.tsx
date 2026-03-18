/**
 * 数据导入页面
 * 整合本地导入和飞书同步两种数据导入方式
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, Zap } from 'lucide-react'
import LocalImportSection from '../components/import/LocalImportSection'
import FeishuSyncSection from '../components/import/FeishuSyncSection'
import DataRuleSection from '../components/import/DataRuleSection'
import { getExtractionRules, getCleaningRules } from '../lib/api'

export default function DataImport() {
  const [activeExtractionRuleId, setActiveExtractionRuleId] = useState<number | null>(null)
  const [activeCleaningRuleId, setActiveCleaningRuleId] = useState<number | null>(null)

  const { data: extractionRules = [] } = useQuery({
    queryKey: ['extraction-rules'],
    queryFn: getExtractionRules,
  })
  const { data: cleaningRules = [] } = useQuery({
    queryKey: ['cleaning-rules'],
    queryFn: getCleaningRules,
  })

  const activeExtractionRule = extractionRules.find((r: any) => r.id === activeExtractionRuleId)
  const activeCleaningRule = cleaningRules.find((r: any) => r.id === activeCleaningRuleId)
  const hasActiveRule = !!activeExtractionRule || !!activeCleaningRule

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">数据归档</h1>
        <p className="text-gray-500 mt-1">让数据找到它的归属之地</p>
      </div>

      {/* 数据规则横幅 */}
      <div className="mb-6">
        <DataRuleSection
          activeExtractionRuleId={activeExtractionRuleId}
          activeCleaningRuleId={activeCleaningRuleId}
          onExtractionRuleChange={setActiveExtractionRuleId}
          onCleaningRuleChange={setActiveCleaningRuleId}
        />
      </div>

      {/* 当前启用规则提示 */}
      {hasActiveRule && (
        <div className="mb-6 flex items-center gap-3 bg-white border border-indigo-100 rounded-lg px-4 py-2.5 shadow-sm animate-in fade-in">
          <span className="text-xs text-gray-500 shrink-0">当前启用</span>
          {activeExtractionRule && (
            <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 rounded-full px-3 py-1 text-xs font-medium">
              <Sparkles className="w-3 h-3" />
              提取规则：{activeExtractionRule.name}
            </span>
          )}
          {activeCleaningRule && (
            <span className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 rounded-full px-3 py-1 text-xs font-medium">
              <Zap className="w-3 h-3" />
              清洗规则：{activeCleaningRule.name}
            </span>
          )}
          <span className="text-xs text-gray-400">下方导入操作将自动应用这些规则</span>
        </div>
      )}

      {/* 主内容区：左右分栏 */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 左侧：本地导入 (30%) */}
        <div className="w-full lg:w-[30%] min-w-[300px]">
          <LocalImportSection
            extractionRuleId={activeExtractionRuleId}
            cleaningRuleId={activeCleaningRuleId}
            extractionRuleName={activeExtractionRule?.name}
            cleaningRuleName={activeCleaningRule?.name}
          />
        </div>

        {/* 右侧：飞书同步 (70%) */}
        <div className="w-full lg:w-[70%] flex-1">
          <FeishuSyncSection
            extractionRuleId={activeExtractionRuleId}
            cleaningRuleId={activeCleaningRuleId}
          />
        </div>
      </div>
    </div>
  )
}