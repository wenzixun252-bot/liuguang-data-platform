import { useState, useMemo, useEffect, useRef } from 'react'
import { Cloud, Table2, FileText, FolderOpen, RefreshCw, Database, Plus, CheckCircle, XCircle, Loader2, MessageSquare, Video } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import CloudDocSync from '../CloudDocSync'
import RecipeSyncConfig from '../RecipeSyncConfig'
import { useTaskProgress } from '../../hooks/useTaskProgress'

interface SyncStatus {
  id: number
  app_token: string
  table_id: string
  table_name: string
  asset_type: string
  last_sync_status: string | null
  last_sync_time: string | null
  records_synced: number
}

interface CloudFolder {
  id: number
  folder_token: string
  folder_name: string
  last_sync_status: string
  last_sync_time: string | null
  files_synced: number
}

interface ImportTask {
  id: number
  task_type: string
  status: string
  total_count: number
  imported_count: number
  skipped_count: number
  failed_count: number
  error_message: string | null
  details: Record<string, unknown>
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// 同步状态指示器
function SyncStatusBadge({ status, syncing }: { status: string | null; syncing: boolean }) {
  if (syncing) {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-600">
        <Loader2 className="w-3 h-3 animate-spin" />
        同步中
      </span>
    )
  }
  if (status === 'success') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600">
        <CheckCircle className="w-3 h-3" />
        成功
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500">
        <XCircle className="w-3 h-3" />
        失败
      </span>
    )
  }
  return null
}

// 沟通资产配方配置 — 增强引导流程
const RECIPE_CONFIGS = {
  meeting: {
    title: '会议纪要导入配置',
    recipeUrl: 'https://recipes.feishu.cn/recipe?template_id=36&ref=share',
    assetType: 'communication' as const,
    recipeKeywords: ['会议纪要', '会议记录', 'Meeting', '会议摘要', '会议'] as string[],
    discoverKeywords: ['会议'] as string[],
    steps: [
      '点击下方按钮跳转飞书工作配方页面',
      '申请加入配方互助群（入群后等待几分钟即可使用）',
      '在飞书中配置「会议」的归档条件（如哪些会议要归档）',
      '保存并启用配方，配方会自动将会议记录写入多维表格',
      '回到流光，从下方列表中选择对应的多维表格进行同步',
    ] as string[],
    icon: Video,
    label: '会议记录',
    desc: '自动同步飞书会议记录',
  },
  chat: {
    title: '群聊摘要导入配置',
    recipeUrl: 'https://recipes.feishu.cn/recipe?template_id=32',
    assetType: 'communication' as const,
    recipeKeywords: ['群聊摘要', '消息汇总', 'Chat', '聊天记录', '群消息', '会话'] as string[],
    discoverKeywords: ['会话', '群聊', '消息'] as string[],
    steps: [
      '点击下方按钮跳转飞书工作配方页面',
      '申请加入配方互助群（入群后等待几分钟即可使用）',
      '在飞书中配置「会话」的归档条件（如哪些群聊要归档）',
      '保存并启用配方，配方会自动将群聊摘要写入多维表格',
      '回到流光，从下方列表中选择对应的多维表格进行同步',
    ] as string[],
    icon: MessageSquare,
    label: '会话记录',
    desc: '自动同步群聊消息汇总',
  },
} as const

type RecipeKey = keyof typeof RECIPE_CONFIGS
type ConfigTarget = RecipeKey | 'structured' | 'structured-bitable' | 'structured-spreadsheet' | null
type DocImportMode = 'cloud-doc' | 'folder-sync'
type ImportTarget = 'document' | 'communication'

interface FeishuSyncSectionProps {
  extractionRuleId: number | null
  cleaningRuleId: number | null
}

export default function FeishuSyncSection({ extractionRuleId, cleaningRuleId }: FeishuSyncSectionProps) {
  const queryClient = useQueryClient()
  const [showCloudDocSync, setShowCloudDocSync] = useState(false)
  const [cloudDocInitMode, setCloudDocInitMode] = useState<DocImportMode>('cloud-doc')
  const [cloudDocTarget, setCloudDocTarget] = useState<ImportTarget>('document')
  const [syncingType, setSyncingType] = useState<'bitable' | 'folder' | null>(null)
  const [configTarget, setConfigTarget] = useState<ConfigTarget>(null)
  const { addTask, updateTask } = useTaskProgress()
  const registeredTaskIds = useRef<Set<string>>(new Set())

  // 获取多维表格同步状态
  const { data: syncStatus = [] } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await api.get('/import/sync-status')
      return res.data as SyncStatus[]
    },
    refetchInterval: 3000,
  })

  // 获取云文件夹列表
  const { data: cloudFolders = [] } = useQuery({
    queryKey: ['cloud-folders'],
    queryFn: async () => {
      const res = await api.get('/import/cloud-folders')
      return res.data as CloudFolder[]
    },
    refetchInterval: 3000,
  })

  // 获取导入任务列表
  const { data: importTasks = [] } = useQuery({
    queryKey: ['import-tasks'],
    queryFn: async () => {
      const res = await api.get('/import/tasks', { params: { limit: 10 } })
      return res.data as ImportTask[]
    },
    refetchInterval: 3000,
  })

  // 将后端导入任务同步到全局任务中心（切换页面不丢失）
  useEffect(() => {
    for (const task of importTasks) {
      const globalId = `feishu-import-${task.id}`
      const isRunning = task.status === 'running' || task.status === 'pending'
      const label =
        task.task_type === 'communication' ? '沟通资产导入' :
        task.task_type === 'cloud_doc' ? '云文档导入' :
        task.task_type === 'folder_sync' ? '文件夹同步' :
        task.task_type === 'bitable_sync' ? '多维表格同步' : '同步任务'
      const countLabel = task.task_type === 'folder_sync'
        ? `${task.total_count} 个文件夹`
        : `${task.total_count} 个文件`

      if (isRunning && !registeredTaskIds.current.has(globalId)) {
        addTask(globalId, `${label} ${countLabel}`)
        registeredTaskIds.current.add(globalId)
      }

      if (registeredTaskIds.current.has(globalId)) {
        if (isRunning) {
          const processed = task.imported_count + task.skipped_count + task.failed_count
          const progress = task.total_count > 0 ? Math.round((processed / task.total_count) * 100) : -1
          updateTask(globalId, {
            progress,
            message: task.status === 'pending' ? '等待中' : `${processed}/${task.total_count}`,
          })
        } else {
          const finalStatus = task.status === 'completed' ? 'done' : 'error'
          const message = task.status === 'completed'
            ? `成功 ${task.imported_count} · 跳过 ${task.skipped_count}`
            : task.status === 'timeout' ? '超时'
            : task.error_message || '失败'
          updateTask(globalId, { status: finalStatus as 'done' | 'error', progress: 100, message })
        }
      }
    }
  }, [importTasks, addTask, updateTask])

  // 按 asset_type 分组
  const { commSources, structuredSources } = useMemo(() => {
    const comm = syncStatus.filter(s => s.asset_type === 'communication')
    const structured = syncStatus.filter(s => s.asset_type === 'structured')
    return { commSources: comm, structuredSources: structured }
  }, [syncStatus])

  // 沟通资产统计
  const commRecords = commSources.reduce((sum, s) => sum + (s.records_synced || 0), 0)
  const commLatestStatus = commSources.find(s => s.last_sync_time)?.last_sync_status || null

  // 表格资产统计
  const structuredRecords = structuredSources.reduce((sum, s) => sum + (s.records_synced || 0), 0)
  const structuredLatestStatus = structuredSources.find(s => s.last_sync_time)?.last_sync_status || null
  const structuredLatestTime = structuredSources
    .filter(s => s.last_sync_time)
    .sort((a, b) => new Date(b.last_sync_time!).getTime() - new Date(a.last_sync_time!).getTime())[0]?.last_sync_time || null

  // 触发多维表格同步
  const syncMutation = useMutation({
    mutationFn: async () => {
      setSyncingType('bitable')
      return await api.post('/import/feishu-sync')
    },
    onSuccess: () => {
      toast.success('同步任务已触发')
      queryClient.invalidateQueries({ queryKey: ['sync-status'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || '同步失败')
    },
    onSettled: () => {
      setTimeout(() => setSyncingType(null), 2000)
    },
  })

  // 触发云文件夹同步
  const syncFolderMutation = useMutation({
    mutationFn: async () => {
      setSyncingType('folder')
      return await api.post('/import/cloud-folders/sync')
    },
    onSuccess: () => {
      toast.success('文件夹同步已触发，可在下方任务面板查看进度')
      queryClient.invalidateQueries({ queryKey: ['cloud-folders'] })
      queryClient.invalidateQueries({ queryKey: ['import-tasks'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || '同步失败')
    },
    onSettled: () => {
      setTimeout(() => setSyncingType(null), 2000)
    },
  })

  const totalFolders = cloudFolders.length
  const totalFiles = cloudFolders.reduce((sum, f) => sum + (f.files_synced || 0), 0)
  const folderSyncing = syncingType === 'folder'
  const bitableSyncing = syncingType === 'bitable'

  // 构建 RecipeSyncConfig 的 props
  const getConfigProps = () => {
    if (!configTarget) return null
    if (configTarget === 'structured' || configTarget === 'structured-bitable' || configTarget === 'structured-spreadsheet') {
      const isBitable = configTarget !== 'structured-spreadsheet'
      return {
        title: configTarget === 'structured-bitable' ? '多维表格导入' :
               configTarget === 'structured-spreadsheet' ? '飞书表格导入' : '配置表格资产数据源',
        recipeUrl: '',
        assetType: 'structured' as const,
        recipeKeywords: [] as string[],
        filterType: configTarget === 'structured-bitable' ? 'bitable' as const :
                    configTarget === 'structured-spreadsheet' ? 'spreadsheet' as const : undefined,
        steps: isBitable ? [
          '点击"刷新列表"自动检索你有阅读权限的飞书多维表格',
          '选择要导入的多维表格数据表，点击可在飞书中查看原表',
          '添加为数据源后点击"同步"开始数据导入',
        ] : [
          '点击"刷新列表"自动检索你有阅读权限的飞书表格',
          '选择要导入的飞书表格，点击可在飞书中查看原表',
          '添加为数据源后点击"同步"开始数据导入',
        ],
      }
    }
    const cfg = RECIPE_CONFIGS[configTarget as RecipeKey]
    return {
      title: cfg.title,
      recipeUrl: cfg.recipeUrl,
      assetType: cfg.assetType,
      recipeKeywords: cfg.recipeKeywords,
      discoverKeywords: cfg.discoverKeywords,
      steps: cfg.steps,
    }
  }

  // 打开导入文档弹窗
  const openDocImport = (mode: DocImportMode, target: ImportTarget = 'document') => {
    setCloudDocInitMode(mode)
    setCloudDocTarget(target)
    setShowCloudDocSync(true)
  }

  return (
    <div className="bg-[#EEF6FF] rounded-2xl p-5 h-full">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 mb-4">
        <Cloud className="w-5 h-5 text-indigo-600" />
        <h2 className="font-semibold text-gray-900">飞书同步</h2>
      </div>

      {/* 卡片网格 - 3列：沟通资产 | 表格资产 | 文档资产 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ═══ 卡片1：沟通资产（配方引导） ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Table2 className="w-5 h-5 text-purple-600" />
              <span className="font-medium text-gray-900">沟通资产</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">通过飞书工作配方自动归档会议和群聊</p>

            {/* 两个配方子卡片 */}
            <div className="space-y-2">
              {(Object.keys(RECIPE_CONFIGS) as RecipeKey[]).map(key => {
                const cfg = RECIPE_CONFIGS[key]
                const Icon = cfg.icon
                // 检查关联状态：table_name 包含关键词（不区分大小写）
                const sources = commSources.filter(s =>
                  cfg.recipeKeywords.some(kw =>
                    s.table_name.toLowerCase().includes(kw.toLowerCase())
                  ) || cfg.discoverKeywords.some(kw =>
                    s.table_name.toLowerCase().includes(kw.toLowerCase())
                  )
                )
                const linked = sources.length > 0
                const latestSync = sources
                  .map(s => s.last_sync_time)
                  .filter(Boolean)
                  .sort()
                  .pop()

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setConfigTarget(key)}
                    className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                        <Icon className="w-3.5 h-3.5 text-purple-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-800">{cfg.label}</span>
                          {linked && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-green-50 text-green-600">已关联</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate">{cfg.desc}</p>
                      </div>
                      {latestSync && (
                        <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0">
                          {new Date(latestSync).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {!latestSync && (
                        <Database className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-400 transition-colors shrink-0" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* 导入会议纪要或文字记录 */}
            <button
              type="button"
              onClick={() => openDocImport('cloud-doc', 'communication')}
              className="w-full text-left p-2.5 rounded-lg border border-dashed border-purple-200 hover:border-purple-300 hover:bg-purple-50/30 transition-colors group mt-1"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                  <FileText className="w-3.5 h-3.5 text-purple-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-700">导入会议纪要或文字记录</span>
                  <p className="text-xs text-gray-400 truncate">搜索含纪要/记录的云文档，智能提取为沟通资产</p>
                </div>
                <Plus className="w-3.5 h-3.5 text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" />
              </div>
            </button>

            {/* 配方使用提示 */}
            {commSources.length === 0 && (
              <div className="mt-3 p-2.5 bg-amber-50 rounded-lg">
                <p className="text-xs text-amber-700 leading-relaxed">
                  <span className="font-medium">首次使用？</span> 点击上方卡片，按引导开通飞书工作配方，
                  配方会自动将会议/群聊归档到多维表格，流光再从表格同步数据。
                </p>
              </div>
            )}

            {/* 沟通资产汇总 */}
            {commSources.length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
                <p>{commSources.length} 个数据源 · {commRecords.toLocaleString()} 条记录</p>
              </div>
            )}
          </div>

          {/* 同步按钮 */}
          <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <SyncStatusBadge status={commLatestStatus} syncing={bitableSyncing} />
            <button
              type="button"
              onClick={() => syncMutation.mutate()}
              disabled={bitableSyncing || commSources.length === 0}
              className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-40 disabled:hover:bg-transparent flex items-center gap-1 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${bitableSyncing ? 'animate-spin' : ''}`} />
              同步
            </button>
          </div>
        </div>

        {/* ═══ 卡片2：表格资产（多维表格 + 飞书表格） ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Table2 className="w-5 h-5 text-amber-600" />
              <span className="font-medium text-gray-900">表格资产</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">自由关联任意飞书多维表格</p>

            {/* 双入口：多维表格导入 + 飞书表格导入 */}
            <button
              type="button"
              onClick={() => setConfigTarget('structured-bitable')}
              className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-amber-200 hover:bg-amber-50/30 transition-colors group mb-2"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                  <Database className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-800">多维表格导入</span>
                  <p className="text-xs text-gray-400 truncate">选择飞书多维表格一键导入</p>
                </div>
                <Plus className="w-3.5 h-3.5 text-gray-300 group-hover:text-amber-400 transition-colors shrink-0" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => setConfigTarget('structured-spreadsheet')}
              className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <Table2 className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-800">飞书表格导入</span>
                  <p className="text-xs text-gray-400 truncate">选择飞书表格导入数据</p>
                </div>
                <Plus className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400 transition-colors shrink-0" />
              </div>
            </button>

            {/* 已导入表格列表 */}
            {structuredSources.length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-100 space-y-1.5">
                {structuredSources.slice(0, 4).map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-xs group">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="text-gray-700 truncate flex-1">{s.table_name}</span>
                    <span className="text-gray-400">{(s.records_synced || 0).toLocaleString()}</span>
                  </div>
                ))}
                {structuredSources.length > 4 && (
                  <p className="text-xs text-gray-400">+{structuredSources.length - 4} 个数据源</p>
                )}
                <div className="text-xs text-gray-500 pt-1 border-t border-gray-100 space-y-0.5">
                  <p>{structuredSources.length} 个数据源 · {structuredRecords.toLocaleString()} 条记录</p>
                  {structuredLatestTime && (
                    <p className="text-gray-400">最近同步: {new Date(structuredLatestTime).toLocaleString('zh-CN')}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 底栏 */}
          <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end">
            <div className="flex items-center gap-2">
              {structuredSources.length > 0 && (
                <>
                  <SyncStatusBadge status={structuredLatestStatus} syncing={bitableSyncing} />
                  <button
                    type="button"
                    onClick={() => syncMutation.mutate()}
                    disabled={bitableSyncing}
                    className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-40 flex items-center gap-1 transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${bitableSyncing ? 'animate-spin' : ''}`} />
                    同步
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ═══ 卡片3：文档资产（云文档导入 + 文件夹同步） ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-gray-900">文档资产</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">从飞书云文档或文件夹导入文档</p>

            {/* 云文档导入模式 */}
            <button
              type="button"
              onClick={() => openDocImport('cloud-doc')}
              className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-colors group mb-2"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-800">云文档导入</span>
                  <p className="text-xs text-gray-400 truncate">选择飞书云文档一键导入</p>
                </div>
                <Plus className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400 transition-colors shrink-0" />
              </div>
            </button>

            {/* 云文件夹同步模式 */}
            <button
              type="button"
              onClick={() => openDocImport('folder-sync')}
              className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                  <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-800">云文件夹同步</span>
                  <p className="text-xs text-gray-400 truncate">
                    自动同步文件夹下的文档和快捷方式
                  </p>
                </div>
                {totalFolders > 0 ? (
                  <span className="text-xs text-gray-400 shrink-0">{totalFolders} 个</span>
                ) : (
                  <Plus className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400 transition-colors shrink-0" />
                )}
              </div>
            </button>

            {/* 文件夹同步明细 */}
            {totalFolders > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-100 space-y-1.5">
                {cloudFolders.slice(0, 4).map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <FolderOpen className="w-3 h-3 text-amber-500 shrink-0" />
                    <span className="text-gray-700 truncate flex-1">{f.folder_name || f.folder_token}</span>
                    <span className="text-gray-400">{f.files_synced} 个文件</span>
                  </div>
                ))}
                {cloudFolders.length > 4 && (
                  <p className="text-xs text-gray-400">+{cloudFolders.length - 4} 个文件夹</p>
                )}
                <div className="text-xs text-gray-500 pt-1 border-t border-gray-100 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span>{totalFolders} 个文件夹 · {totalFiles} 个文件</span>
                    <button
                      type="button"
                      onClick={() => syncFolderMutation.mutate()}
                      disabled={folderSyncing}
                      className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3 h-3 ${folderSyncing ? 'animate-spin' : ''}`} />
                      同步文件夹
                    </button>
                  </div>
                  {(() => {
                    const latestFolderTime = cloudFolders
                      .filter(f => f.last_sync_time)
                      .sort((a, b) => new Date(b.last_sync_time!).getTime() - new Date(a.last_sync_time!).getTime())[0]?.last_sync_time
                    return latestFolderTime ? (
                      <p className="text-gray-400">最近更新: {new Date(latestFolderTime.endsWith('Z') ? latestFolderTime : latestFolderTime + 'Z').toLocaleString('zh-CN')}</p>
                    ) : null
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 云文档同步弹窗 */}
      {showCloudDocSync && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCloudDocSync(false)} />
          <div className="absolute inset-4 lg:inset-20 bg-white rounded-2xl overflow-hidden">
            <CloudDocSync
              onClose={() => setShowCloudDocSync(false)}
              initialMode={cloudDocInitMode}
              targetTable={cloudDocTarget}
              extractionRuleId={extractionRuleId}
            />
          </div>
        </div>
      )}

      {/* 配置数据源弹窗 */}
      {configTarget && (() => {
        const props = getConfigProps()
        if (!props) return null
        return (
          <RecipeSyncConfig
            {...props}
            cleaningRuleId={cleaningRuleId}
            extractionRuleId={extractionRuleId}
            onClose={() => setConfigTarget(null)}
            onSyncComplete={() => {
              queryClient.invalidateQueries({ queryKey: ['sync-status'] })
            }}
          />
        )
      })()}
    </div>
  )
}
