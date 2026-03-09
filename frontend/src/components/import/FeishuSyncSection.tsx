import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cloud, Table2, FileText, FolderOpen, RefreshCw, Settings, Plus, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import CloudDocSync from '../CloudDocSync'

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

// 格式化时间
function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return '从未同步'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 7) return `${diffDays} 天前`
  return date.toLocaleDateString()
}

export default function FeishuSyncSection() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCloudDocSync, setShowCloudDocSync] = useState(false)
  const [syncingType, setSyncingType] = useState<'bitable' | 'folder' | null>(null)

  // 获取多维表格同步状态
  const { data: syncStatus = [] } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await api.get('/api/import/sync-status')
      return res.data as SyncStatus[]
    },
    refetchInterval: 3000, // 每3秒刷新
  })

  // 获取云文件夹列表
  const { data: cloudFolders = [] } = useQuery({
    queryKey: ['cloud-folders'],
    queryFn: async () => {
      const res = await api.get('/api/import/cloud-folders')
      return res.data as CloudFolder[]
    },
    refetchInterval: 3000,
  })

  // 触发多维表格同步
  const syncMutation = useMutation({
    mutationFn: async () => {
      setSyncingType('bitable')
      return await api.post('/api/import/feishu-sync')
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
      return await api.post('/api/import/cloud-folders/sync')
    },
    onSuccess: () => {
      toast.success('文件夹同步已触发')
      queryClient.invalidateQueries({ queryKey: ['cloud-folders'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || '同步失败')
    },
    onSettled: () => {
      setTimeout(() => setSyncingType(null), 2000)
    },
  })

  // 计算汇总数据
  const totalSources = syncStatus.length
  const totalRecords = syncStatus.reduce((sum, s) => sum + (s.records_synced || 0), 0)
  const latestSync = syncStatus.reduce((latest: Date | null, s) => {
    if (!s.last_sync_time) return latest
    const t = new Date(s.last_sync_time)
    return (!latest || t > latest) ? t : latest
  }, null)
  const latestStatus = syncStatus.find(s => s.last_sync_time)?.last_sync_status || 'idle'

  // 多维表格卡片状态
  const bitableSyncing = syncingType === 'bitable'
  const bitableSuccess = latestStatus === 'success'
  const bitableFailed = latestStatus === 'failed'

  // 云文件夹汇总
  const totalFolders = cloudFolders.length
  const totalFiles = cloudFolders.reduce((sum, f) => sum + (f.files_synced || 0), 0)
  const folderSyncing = syncingType === 'folder'

  return (
    <div className="bg-[#EEF6FF] rounded-2xl p-5 h-full">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 mb-4">
        <Cloud className="w-5 h-5 text-indigo-600" />
        <h2 className="font-semibold text-gray-900">飞书同步</h2>
      </div>

      {/* 卡片网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 多维表格同步卡片 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Table2 className="w-5 h-5 text-indigo-600" />
              <span className="font-medium text-gray-900">多维表格同步</span>
            </div>
            <p className="text-sm text-gray-500 mb-3">配置数据源，定时自动同步</p>

            {totalSources > 0 ? (
              <div className="space-y-1 text-sm">
                <p className="text-gray-600">已配置 <span className="font-medium text-gray-900">{totalSources}</span> 个数据源</p>
                <p className="text-gray-600">共同步 <span className="font-medium text-gray-900">{totalRecords.toLocaleString()}</span> 条记录</p>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                <p>还没有配置数据源</p>
                <p className="text-gray-400">点击下方按钮开始同步</p>
              </div>
            )}
          </div>

          {/* 状态栏 */}
          <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">最近同步：</span>
              <span className="text-sm text-gray-700">{formatTimeAgo(latestSync?.toISOString() || null)}</span>
            </div>
            <div className="flex items-center gap-2">
              {bitableSyncing ? (
                <span className="flex items-center gap-1 text-sm text-blue-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  同步中...
                </span>
              ) : bitableSuccess ? (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  同步成功
                </span>
              ) : bitableFailed ? (
                <span className="flex items-center gap-1 text-sm text-red-600">
                  <XCircle className="w-4 h-4" />
                  同步失败
                </span>
              ) : null}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <button
              onClick={() => navigate('/settings?tab=sync')}
              className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1"
            >
              <Settings className="w-4 h-4" />
              管理
            </button>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={bitableSyncing || totalSources === 0}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <RefreshCw className={`w-4 h-4 ${bitableSyncing ? 'animate-spin' : ''}`} />
              同步
            </button>
          </div>
        </div>

        {/* 云文档导入卡片 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-indigo-600" />
              <span className="font-medium text-gray-900">云文档导入</span>
            </div>
            <p className="text-sm text-gray-500 mb-3">选择云文档，一键导入</p>

            <div className="text-sm text-gray-600">
              <p>已导入 <span className="font-medium text-gray-900">0</span> 篇文档</p>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <button
              onClick={() => setShowCloudDocSync(true)}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              选择文档
            </button>
          </div>
        </div>

        {/* 云文件夹同步卡片 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="w-5 h-5 text-indigo-600" />
              <span className="font-medium text-gray-900">文件夹同步</span>
            </div>
            <p className="text-sm text-gray-500 mb-3">配置文件夹，自动同步</p>

            {totalFolders > 0 ? (
              <div className="text-sm text-gray-600">
                <p>已配置 <span className="font-medium text-gray-900">{totalFolders}</span> 个文件夹</p>
                <p>已同步 <span className="font-medium text-gray-900">{totalFiles}</span> 个文件</p>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                <p>还没有配置文件夹</p>
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <button
              onClick={() => navigate('/settings?tab=sync')}
              className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1"
            >
              <Settings className="w-4 h-4" />
              管理
            </button>
            <button
              onClick={() => syncFolderMutation.mutate()}
              disabled={folderSyncing || totalFolders === 0}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <RefreshCw className={`w-4 h-4 ${folderSyncing ? 'animate-spin' : ''}`} />
              同步
            </button>
          </div>
        </div>
      </div>

      {/* 云文档同步弹窗 */}
      {showCloudDocSync && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCloudDocSync(false)} />
          <div className="absolute inset-4 lg:inset-20 bg-white rounded-2xl overflow-hidden">
            <CloudDocSync onClose={() => setShowCloudDocSync(false)} />
          </div>
        </div>
      )}
    </div>
  )
}