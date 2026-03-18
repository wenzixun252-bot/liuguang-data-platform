import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Search, RefreshCw, Trash2, Plus, ExternalLink, Check,
  ChevronDown, ChevronRight, Loader2, X, Settings, AlertTriangle,
  Sparkles, Video, MessageSquare,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api, { getExtractionRules } from '../lib/api'
import toast from 'react-hot-toast'

/* ── 类型 ─────────────────────────────────── */

interface DataSource {
  id: number
  app_token: string
  table_id: string
  table_name: string
  asset_type: string
  is_enabled: boolean
  extraction_rule_id?: number | null
  created_at: string
  last_sync_status?: string | null
  last_sync_time?: string | null
  records_synced?: number | null
  error_message?: string | null
}

// 会议纪要 vs 会话记录的关键词分类
const MEETING_KEYWORDS = ['会议', '纪要', 'meeting', '会议纪要', '会议记录', '会议摘要']
const CHAT_KEYWORDS = ['会话', '群聊', '消息', '聊天', 'chat', '群聊摘要', '消息汇总']

function classifySource(tableName: string): 'meeting' | 'chat' | 'unknown' {
  const lower = tableName.toLowerCase()
  if (MEETING_KEYWORDS.some(k => lower.includes(k))) return 'meeting'
  if (CHAT_KEYWORDS.some(k => lower.includes(k))) return 'chat'
  return 'unknown'
}

interface BitableApp {
  app_token: string
  app_name: string
  type: string  // "bitable" | "spreadsheet" | "wiki"
  tables: { table_id: string; name: string }[]
}

/* ── Props ────────────────────────────────── */

interface RecipeSyncConfigProps {
  title: string
  recipeUrl: string
  assetType: string
  recipeKeywords: string[]
  discoverKeywords?: string[]
  steps: string[]
  filterType?: 'bitable' | 'spreadsheet'
  cleaningRuleId?: number | null
  extractionRuleId?: number | null
  onClose: () => void
  onSyncComplete?: () => void
}

export default function RecipeSyncConfig({
  title, recipeUrl, assetType, recipeKeywords, discoverKeywords = [], steps, filterType, cleaningRuleId: externalCleaningRuleId = null, extractionRuleId: externalExtractionRuleId = null, onClose, onSyncComplete,
}: RecipeSyncConfigProps) {
  // 数据源列表
  const [sources, setSources] = useState<DataSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)

  // 自动检索
  const [bitableApps, setBitableApps] = useState<BitableApp[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [matchedApps, setMatchedApps] = useState<BitableApp[]>([])
  const [unmatchedApps, setUnmatchedApps] = useState<BitableApp[]>([])
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set())
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set())
  const [selectedTable, setSelectedTable] = useState<{ app_token: string; table_id: string; table_name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [appSearch, setAppSearch] = useState('')

  // 清洗规则：使用外部传入的
  const cleaningRuleId = externalCleaningRuleId
  const extractionRuleId = externalExtractionRuleId

  // 提取规则列表（用于已关联数据源的规则选择器）
  const { data: extractionRules = [] } = useQuery({ queryKey: ['extraction-rules'], queryFn: getExtractionRules })

  // 粘贴链接
  const [showPasteUrl, setShowPasteUrl] = useState(false)
  const [pasteUrl, setPasteUrl] = useState('')
  const [addingFromUrl, setAddingFromUrl] = useState(false)

  // 轮询
  const [polling, setPolling] = useState(false)
  const [syncingSourceId, setSyncingSourceId] = useState<number | null>(null)

  const existingKeys = new Set(sources.map((s) => `${s.app_token}:${s.table_id}`))

  // 是否为沟通数据配方模式（需要筛选会议/会话表格）
  const isRecipeMode = assetType === 'communication' && recipeUrl !== ''

  /* ── 加载数据源 ─────────────────────────── */

  const loadSources = useCallback((silent = false) => {
    if (!silent) setSourcesLoading(true)
    api.get('/import/sync-status', { params: { asset_type: assetType } })
      .then((res) => setSources(res.data))
      .catch(() => { if (!silent) toast.error('加载数据源失败') })
      .finally(() => { if (!silent) setSourcesLoading(false) })
  }, [assetType])

  useEffect(() => { loadSources() }, [loadSources])

  // mount 时检查：有没有正在运行的数据源同步
  useEffect(() => {
    api.get('/import/sync-status', { params: { asset_type: assetType } })
      .then((res) => {
        const sources = Array.isArray(res.data) ? res.data : []
        const hasRunning = sources.some((s: DataSource) => s.last_sync_status === 'running')
        if (hasRunning) {
          setSources(sources)
          setPolling(true)
        }
      })
      .catch(() => {})
  }, [assetType])

  // 同步轮询
  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => {
      api.get('/import/sync-status', { params: { asset_type: assetType } }).then((res) => {
        const data = Array.isArray(res.data) ? res.data : []
        setSources(data)
        const hasRunning = data.some((s: DataSource) => s.last_sync_status === 'running')
        if (!hasRunning) {
          setPolling(false)
          setSyncingSourceId(null)
          const hasFailed = data.some((s: DataSource) => s.last_sync_status === 'failed')
          if (hasFailed) {
            toast.error('部分数据源同步失败')
          } else {
            toast.success('同步完成')
          }
          onSyncComplete?.()
        }
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [polling, assetType, onSyncComplete])

  /* ── 自动检索配方表格 ──────────────────── */

  const doDiscover = async () => {
    setDiscovering(true)
    try {
      const res = await api.get('/import/feishu-discover')
      let apps: BitableApp[] = res.data

      // 按入口类型过滤：多维表格只看 bitable/wiki，飞书表格只看 spreadsheet
      if (filterType === 'bitable') {
        apps = apps.filter(a => a.type === 'bitable' || a.type === 'wiki')
      } else if (filterType === 'spreadsheet') {
        apps = apps.filter(a => a.type === 'spreadsheet')
      }

      setBitableApps(apps)

      // 关键词匹配
      const keywords = recipeKeywords.map(k => k.toLowerCase())
      const matched: BitableApp[] = []
      const unmatched: BitableApp[] = []
      for (const app of apps) {
        const name = app.app_name.toLowerCase()
        if (keywords.some(k => name.includes(k))) {
          matched.push(app)
        } else {
          unmatched.push(app)
        }
      }
      setMatchedApps(matched)
      setUnmatchedApps(unmatched)

      // 自动展开匹配到的
      if (matched.length > 0) {
        const firstToken = matched[0].app_token
        setExpandedApps(new Set([firstToken]))
        // 自动加载子表
        if (matched[0].tables.length === 0) {
          await loadSubTables(firstToken)
        }
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '获取飞书多维表格列表失败')
    } finally {
      setDiscovering(false)
    }
  }

  useEffect(() => {
    // 自动发现
    doDiscover()
  }, [])

  const loadSubTables = async (appToken: string) => {
    setLoadingTables((prev) => new Set(prev).add(appToken))
    try {
      const app = [...matchedApps, ...unmatchedApps, ...bitableApps].find((a) => a.app_token === appToken)
      const docType = app?.type || 'bitable'
      const res = await api.get(`/import/feishu-discover/${appToken}/tables`, { params: { type: docType } })
      const updater = (prev: BitableApp[]) =>
        prev.map((a) => a.app_token === appToken ? { ...a, tables: res.data } : a)
      setBitableApps(updater)
      setMatchedApps(updater)
      setUnmatchedApps(updater)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '获取数据表列表失败')
    } finally {
      setLoadingTables((prev) => {
        const next = new Set(prev)
        next.delete(appToken)
        return next
      })
    }
  }

  const toggleApp = async (appToken: string) => {
    if (expandedApps.has(appToken)) {
      setExpandedApps((prev) => {
        const next = new Set(prev)
        next.delete(appToken)
        return next
      })
      return
    }

    const app = [...matchedApps, ...unmatchedApps].find((a) => a.app_token === appToken)
    if (app && app.tables.length === 0) {
      await loadSubTables(appToken)
    }
    setExpandedApps((prev) => new Set(prev).add(appToken))
  }

  const handleSelectTable = (appToken: string, tableId: string, tableName: string) => {
    setSelectedTable({ app_token: appToken, table_id: tableId, table_name: tableName })
  }

  const handleAddSource = async () => {
    if (!selectedTable) { toast.error('请选择一个数据表'); return }
    if (existingKeys.has(`${selectedTable.app_token}:${selectedTable.table_id}`)) {
      toast.error('该数据源已添加')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/import/feishu-source', {
        app_token: selectedTable.app_token,
        table_id: selectedTable.table_id,
        table_name: selectedTable.table_name,
        asset_type: assetType,
        ...(cleaningRuleId && { cleaning_rule_id: cleaningRuleId }),
        ...(extractionRuleId && { extraction_rule_id: extractionRuleId }),
      })
      toast.success('数据源已添加')
      setSelectedTable(null)
      loadSources()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  /* ── 粘贴链接 ──────────────────────────── */

  const handleAddFromUrl = async () => {
    if (!pasteUrl.trim()) { toast.error('请粘贴链接'); return }
    setAddingFromUrl(true)
    try {
      await api.post('/import/feishu-source-from-url', {
        url: pasteUrl.trim(),
        asset_type: assetType,
        ...(cleaningRuleId && { cleaning_rule_id: cleaningRuleId }),
        ...(extractionRuleId && { extraction_rule_id: extractionRuleId }),
      })
      toast.success('数据源已添加')
      setPasteUrl('')
      loadSources()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '添加失败')
    } finally {
      setAddingFromUrl(false)
    }
  }

  /* ── 数据源操作 ────────────────────────── */

  const handleSyncSingle = async (sourceId: number) => {
    setSyncingSourceId(sourceId)
    try {
      await api.post(`/import/feishu-sync/${sourceId}`)
      toast.success('同步任务已触发')
      setPolling(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '触发失败')
      setSyncingSourceId(null)
    }
  }

  const handleDeleteSource = async (id: number) => {
    if (!confirm('确定删除此数据源？')) return
    try {
      await api.delete(`/import/feishu-source/${id}`)
      toast.success('已删除')
      loadSources()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleUpdateSourceRule = async (sourceId: number, ruleId: number | null) => {
    try {
      await api.patch(`/import/feishu-source/${sourceId}`, { extraction_rule_id: ruleId })
      loadSources()
    } catch {
      toast.error('更新提取规则失败')
    }
  }

  /* ── 渲染 ──────────────────────────────── */

  // 配方模式下，只显示关键词匹配的数据源；非配方模式显示全部
  const allKeywords = [...recipeKeywords, ...discoverKeywords]
  const displaySources = isRecipeMode
    ? sources.filter(s => {
        const name = s.table_name.toLowerCase()
        return allKeywords.some(kw => name.includes(kw.toLowerCase()))
      })
    : sources

  const hasNoSources = displaySources.length === 0 && !sourcesLoading

  const filteredUnmatched = unmatchedApps.filter(a =>
    !appSearch || a.app_name.toLowerCase().includes(appSearch.toLowerCase())
  )

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Settings size={18} />
            {title}
          </h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded" title="关闭" aria-label="关闭"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 区域 A: 配方引导教程（首次无数据源时显示） */}
          {hasNoSources && (
            <div className="bg-blue-50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-blue-800 text-sm">
                {isRecipeMode ? '飞书工作配方配置指南' : '配置教程'}
              </h4>
              <ol className="space-y-2">
                {steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-blue-700">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {recipeUrl && (
                <a
                  href={recipeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  <ExternalLink size={14} />
                  打开飞书工作配方
                </a>
              )}
            </div>
          )}

          {/* 区域 A2: 配方引导提示（已有数据源时收起显示） */}
          {!hasNoSources && isRecipeMode && recipeUrl && (
            <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-gray-500">需要重新配置配方？</span>
              <a
                href={recipeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                <ExternalLink size={12} />
                打开飞书工作配方
              </a>
            </div>
          )}

          {/* 区域 B: 自动检索配方表格 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-700 text-sm">
                {isRecipeMode ? '选择配方创建的多维表格' : '关联数据表'}
              </h4>
              <button
                type="button"
                onClick={doDiscover}
                disabled={discovering}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50"
              >
                <RefreshCw size={12} className={discovering ? 'animate-spin' : ''} />
                {discovering ? '检索中...' : '刷新列表'}
              </button>
            </div>

            {/* 配方模式下的筛选提示 */}
            {isRecipeMode && !discovering && matchedApps.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                <p className="text-sm text-green-700 font-medium flex items-center gap-1.5">
                  <Check size={14} />
                  已自动筛选出包含"会议"或"会话"关键词的多维表格
                </p>
                <p className="text-xs text-green-600">请选择配方生成的对应数据表，然后点击"添加数据源"</p>
              </div>
            )}

            {/* 配方模式下未找到匹配的提示 */}
            {isRecipeMode && !discovering && bitableApps.length > 0 && matchedApps.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <p className="text-sm text-amber-700 font-medium flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  未找到包含"会议"或"会话"关键词的多维表格
                </p>
                <p className="text-xs text-amber-600">
                  请确认已在飞书中启用工作配方并等待配方创建多维表格。
                  如果配方表格名称不同，可从下方完整列表中手动选择。
                </p>
              </div>
            )}

            {discovering ? (
              <div className="py-6 text-center text-gray-400">
                <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                {filterType === 'spreadsheet' ? '正在检索飞书表格...' : '正在检索飞书多维表格...'}
              </div>
            ) : (
              <>
                {/* 匹配到的推荐 */}
                {matchedApps.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm text-green-700 font-medium">
                      {isRecipeMode ? '推荐关联的配方表格：' : '检测到可能的配方表格：'}
                    </p>
                    {matchedApps.map((app) => (
                      <AppItem
                        key={app.app_token}
                        app={app}
                        expanded={expandedApps.has(app.app_token)}
                        loadingTables={loadingTables.has(app.app_token)}
                        existingKeys={existingKeys}
                        selectedTable={selectedTable}
                        onToggle={() => toggleApp(app.app_token)}
                        onSelectTable={handleSelectTable}
                        highlight
                      />
                    ))}
                  </div>
                )}

                {/* 未匹配的完整列表 */}
                {(matchedApps.length === 0 || unmatchedApps.length > 0) && (
                  <div className="space-y-2">
                    {matchedApps.length > 0 && (
                      <p className="text-xs text-gray-500">以上不是？从完整列表中选择：</p>
                    )}
                    {unmatchedApps.length > 5 && (
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          placeholder={filterType === 'spreadsheet' ? '搜索飞书表格名称...' : '搜索多维表格名称...'}
                          className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                          value={appSearch}
                          onChange={(e) => setAppSearch(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-50">
                      {filteredUnmatched.map((app) => (
                        <AppItem
                          key={app.app_token}
                          app={app}
                          expanded={expandedApps.has(app.app_token)}
                          loadingTables={loadingTables.has(app.app_token)}
                          existingKeys={existingKeys}
                          selectedTable={selectedTable}
                          onToggle={() => toggleApp(app.app_token)}
                          onSelectTable={handleSelectTable}
                        />
                      ))}
                      {filteredUnmatched.length === 0 && (
                        <div className="px-3 py-4 text-sm text-gray-400 text-center">
                          {bitableApps.length === 0 ? (filterType === 'spreadsheet' ? '未发现飞书表格' : '未发现多维表格') : '无匹配结果'}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 确认添加按钮 */}
                {selectedTable && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">
                      已选择: <span className="font-medium text-indigo-700">{selectedTable.table_name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleAddSource}
                      disabled={submitting}
                      className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Plus size={14} />
                      {submitting ? '添加中...' : '添加数据源'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 区域 C: 兜底 — 粘贴链接 */}
          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setShowPasteUrl(!showPasteUrl)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600"
            >
              <ChevronDown size={14} className={`transition-transform ${showPasteUrl ? 'rotate-180' : ''}`} />
              在列表中找不到？粘贴飞书表格链接
            </button>
            {showPasteUrl && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  placeholder="https://xxx.feishu.cn/base/... 或 /sheets/... 或 /wiki/..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddFromUrl() }}
                />
                <button
                  type="button"
                  onClick={handleAddFromUrl}
                  disabled={addingFromUrl}
                  className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Plus size={14} />
                  {addingFromUrl ? '添加中...' : '添加'}
                </button>
              </div>
            )}
          </div>

          {/* 区域 D: 已关联数据源管理 */}
          {displaySources.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-gray-700 text-sm">已关联数据源</h4>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-50">
                {displaySources.map((s) => {
                  // 构建原表格跳转链接
                  const sourceUrl = s.app_token
                    ? `https://feishu.cn/base/${s.app_token}?table=${s.table_id}`
                    : null
                  const sourceType = isRecipeMode ? classifySource(s.table_name) : 'unknown'
                  const TypeIcon = sourceType === 'meeting' ? Video : sourceType === 'chat' ? MessageSquare : null
                  const typeLabel = sourceType === 'meeting' ? '会议纪要' : sourceType === 'chat' ? '会话记录' : null
                  const matchedRule = extractionRules.find((r: any) => r.id === s.extraction_rule_id)

                  return (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                      {/* 类型图标 */}
                      {TypeIcon && (
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          sourceType === 'meeting' ? 'bg-purple-50' : 'bg-blue-50'
                        }`}>
                          <TypeIcon size={14} className={sourceType === 'meeting' ? 'text-purple-600' : 'text-blue-600'} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-800 truncate">{s.table_name || s.table_id}</p>
                          {typeLabel && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] shrink-0 ${
                              sourceType === 'meeting' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'
                            }`}>{typeLabel}</span>
                          )}
                          {sourceUrl && (
                            <a
                              href={sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-300 hover:text-indigo-500 transition-colors shrink-0"
                              title="在飞书中查看原表"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          {s.last_sync_time ? `最后同步: ${new Date(s.last_sync_time).toLocaleString('zh-CN')}` : '从未同步'}
                          {s.records_synced ? ` · ${s.records_synced} 条记录` : ''}
                        </p>
                      </div>
                      {/* 提取规则选择器（仅沟通数据模式显示） */}
                      {isRecipeMode && (
                        matchedRule ? (
                          <span
                            title="点击移除提取规则"
                            onClick={() => handleUpdateSourceRule(s.id, null)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 cursor-pointer hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                          >
                            <Sparkles size={10} />
                            {matchedRule.name}
                            <X size={10} className="opacity-60" />
                          </span>
                        ) : extractionRules.length > 0 ? (
                          <SourceRulePicker
                            rules={extractionRules}
                            onSelect={(ruleId) => handleUpdateSourceRule(s.id, ruleId)}
                          />
                        ) : null
                      )}
                      <SyncStatusBadge status={s.last_sync_status} errorMessage={s.error_message} />
                      <button
                        type="button"
                        onClick={() => handleSyncSingle(s.id)}
                        disabled={syncingSourceId === s.id || s.last_sync_status === 'running'}
                        className="p-1.5 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded disabled:opacity-50"
                        title="同步"
                      >
                        <RefreshCw size={14} className={(syncingSourceId === s.id || s.last_sync_status === 'running') ? 'animate-spin' : ''} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSource(s.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {sourcesLoading && (
            <div className="py-4 text-center text-gray-400 text-sm">加载中...</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 多维表格条目 ────────────────────────── */

function AppItem({
  app, expanded, loadingTables, existingKeys, selectedTable, onToggle, onSelectTable, highlight,
}: {
  app: BitableApp
  expanded: boolean
  loadingTables: boolean
  existingKeys: Set<string>
  selectedTable: { app_token: string; table_id: string; table_name: string } | null
  onToggle: () => void
  onSelectTable: (appToken: string, tableId: string, tableName: string) => void
  highlight?: boolean
}) {
  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 rounded ${highlight ? 'bg-green-50' : ''}`}
        onClick={onToggle}
      >
        {loadingTables ? (
          <Loader2 size={14} className="text-indigo-500 animate-spin" />
        ) : expanded ? (
          <ChevronDown size={14} className="text-gray-400" />
        ) : (
          <ChevronRight size={14} className="text-gray-400" />
        )}
        <span className="text-sm font-medium text-gray-700 flex-1 truncate">{app.app_name}</span>
        {app.type === 'spreadsheet' ? (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 shrink-0">飞书表格</span>
        ) : (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-50 text-amber-600 shrink-0">多维表格</span>
        )}
        <a
          href={`https://feishu.cn/${app.type === 'spreadsheet' ? 'sheets' : 'base'}/${app.app_token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-300 hover:text-indigo-500 transition-colors shrink-0"
          title="在飞书中查看"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={12} />
        </a>
        <span className="text-xs text-gray-400">
          {app.tables.length > 0 ? `${app.tables.length} 个表` : '点击展开'}
        </span>
      </div>

      {expanded && loadingTables && (
        <div className="px-8 py-3 text-center text-gray-400 text-xs">
          <Loader2 size={12} className="animate-spin inline mr-1" />
          加载中...
        </div>
      )}

      {expanded && !loadingTables && app.tables.map((table) => {
        const key = `${app.app_token}:${table.table_id}`
        const isExisting = existingKeys.has(key)
        const isSelected = selectedTable?.app_token === app.app_token && selectedTable?.table_id === table.table_id

        return (
          <div
            key={key}
            className={`flex items-center gap-2 px-3 py-2 pl-8 text-sm ${
              isExisting ? 'opacity-50' : 'hover:bg-indigo-50 cursor-pointer'
            } ${isSelected ? 'bg-indigo-50' : ''}`}
            onClick={() => !isExisting && onSelectTable(app.app_token, table.table_id, table.name)}
          >
            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${
              isExisting ? 'bg-gray-200 border-gray-300' :
              isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
            }`}>
              {(isExisting || isSelected) && <Check size={8} className="text-white" />}
            </div>
            <span className="text-gray-700 flex-1 truncate">{table.name}</span>
            {isExisting && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">已添加</span>}
          </div>
        )
      })}
    </div>
  )
}

/* ── 同步状态标签 ────────────────────────── */

function SyncStatusBadge({ status, errorMessage }: { status?: string | null; errorMessage?: string | null }) {
  if (!status || status === 'idle') {
    return <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-500">未同步</span>
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-600">
        <Loader2 size={10} className="animate-spin" />
        同步中
      </span>
    )
  }
  if (status === 'success') {
    return <span className="px-2 py-0.5 rounded-full text-[10px] bg-green-50 text-green-600">成功</span>
  }
  if (status === 'failed') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] bg-red-50 text-red-600" title={errorMessage || ''}>
        失败
      </span>
    )
  }
  return <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-500">{status}</span>
}

/* ── 数据源提取规则选择器 ───────────────── */

function SourceRulePicker({ rules, onSelect }: { rules: any[]; onSelect: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
      >
        <Plus size={10} />
        提取规则
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px]">
          {rules.map((r: any) => (
            <button
              type="button"
              key={r.id}
              onClick={() => { onSelect(r.id); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
