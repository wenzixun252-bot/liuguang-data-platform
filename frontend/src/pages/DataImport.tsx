import { useEffect, useState, useCallback } from 'react'
import { Upload, Cloud, RefreshCw, Trash2, Plus, FileUp, Search, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface DataSource {
  id: number
  app_token: string
  table_id: string
  table_name: string
  asset_type: string
  is_enabled: boolean
  created_at: string
  // 同步状态字段
  last_sync_status?: string | null
  last_sync_time?: string | null
  records_synced?: number | null
  error_message?: string | null
}

interface BitableTable {
  table_id: string
  name: string
}

interface BitableApp {
  app_token: string
  app_name: string
  tables: BitableTable[]
}

interface SelectedTable {
  app_token: string
  table_id: string
  table_name: string
  asset_type: string
}

interface UploadedFile {
  id: number
  title: string | null
  file_type: string | null
  file_size: number | null
  source_type: string
  category: string | null
  created_at: string
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  document: '文档',
  meeting: '会议',
  chat_message: '聊天记录',
}

export default function DataImport() {
  const [tab, setTab] = useState<'feishu' | 'upload'>('feishu')

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">数据导入</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('feishu')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'feishu' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Cloud size={16} />
          飞书同步
        </button>
        <button
          onClick={() => setTab('upload')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'upload' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <FileUp size={16} />
          文件上传
        </button>
      </div>

      {tab === 'feishu' ? <FeishuSyncTab /> : <FileUploadTab />}
    </div>
  )
}

function FeishuSyncTab() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  // 发现相关状态
  const [showDiscover, setShowDiscover] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [bitableApps, setBitableApps] = useState<BitableApp[]>([])
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set())
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set())  // 正在加载子表的 app
  const [selectedTables, setSelectedTables] = useState<Map<string, SelectedTable>>(new Map())
  const [submitting, setSubmitting] = useState(false)

  // 已存在的数据源 key 集合，用于标记"已添加"
  const existingKeys = new Set(sources.map((s) => `${s.app_token}:${s.table_id}`))

  const [polling, setPolling] = useState(false)

  const loadSources = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    api.get('/import/sync-status')
      .then((res) => setSources(res.data))
      .catch(() => {
        if (!silent) toast.error('加载数据源失败')
      })
      .finally(() => { if (!silent) setLoading(false) })
  }, [])

  useEffect(() => { loadSources() }, [loadSources])

  // 同步触发后轮询状态
  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => {
      api.get('/import/sync-status').then((res) => {
        setSources(res.data)
        const hasRunning = res.data.some((s: DataSource) => s.last_sync_status === 'running')
        if (!hasRunning) {
          setPolling(false)
          setSyncing(false)
          const hasFailed = res.data.some((s: DataSource) => s.last_sync_status === 'failed')
          if (hasFailed) {
            toast.error('部分数据源同步失败，请查看详情')
          } else {
            toast.success('同步完成')
          }
        }
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [polling])

  const handleDiscover = async () => {
    setShowDiscover(true)
    setDiscovering(true)
    setSelectedTables(new Map())
    setExpandedApps(new Set())
    try {
      const res = await api.get('/import/feishu-discover')
      setBitableApps(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '获取飞书多维表格列表失败')
    } finally {
      setDiscovering(false)
    }
  }

  const toggleApp = async (appToken: string) => {
    if (expandedApps.has(appToken)) {
      // 收起
      setExpandedApps((prev) => {
        const next = new Set(prev)
        next.delete(appToken)
        return next
      })
      return
    }

    // 展开：查找该 app，如果子表为空则懒加载
    const app = bitableApps.find((a) => a.app_token === appToken)
    if (app && app.tables.length === 0) {
      setLoadingTables((prev) => new Set(prev).add(appToken))
      try {
        const res = await api.get(`/import/feishu-discover/${appToken}/tables`)
        setBitableApps((prev) =>
          prev.map((a) => a.app_token === appToken ? { ...a, tables: res.data } : a)
        )
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

    setExpandedApps((prev) => new Set(prev).add(appToken))
  }

  const tableKey = (appToken: string, tableId: string) => `${appToken}:${tableId}`

  const toggleTable = (appToken: string, table: BitableTable) => {
    const key = tableKey(appToken, table.table_id)
    if (existingKeys.has(key)) return // 已添加的不可选
    setSelectedTables((prev) => {
      const next = new Map(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.set(key, {
          app_token: appToken,
          table_id: table.table_id,
          table_name: table.name,
          asset_type: 'document',
        })
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    const selectable = bitableApps.flatMap((app) =>
      app.tables
        .filter((t) => !existingKeys.has(tableKey(app.app_token, t.table_id)))
        .map((t) => ({ app, table: t }))
    )
    if (selectedTables.size >= selectable.length) {
      setSelectedTables(new Map())
    } else {
      const next = new Map<string, SelectedTable>()
      for (const { app, table } of selectable) {
        const key = tableKey(app.app_token, table.table_id)
        next.set(key, {
          app_token: app.app_token,
          table_id: table.table_id,
          table_name: table.name,
          asset_type: 'document',
        })
      }
      setSelectedTables(next)
    }
  }

  const updateAssetType = (key: string, assetType: string) => {
    setSelectedTables((prev) => {
      const next = new Map(prev)
      const item = next.get(key)
      if (item) next.set(key, { ...item, asset_type: assetType })
      return next
    })
  }

  const handleBatchAdd = async () => {
    if (selectedTables.size === 0) {
      toast.error('请至少选择一个表')
      return
    }
    setSubmitting(true)
    try {
      const payload = Array.from(selectedTables.values())
      const res = await api.post('/import/feishu-sources-batch', payload)
      const count = res.data.length
      toast.success(`成功添加 ${count} 个数据源`)
      setShowDiscover(false)
      setSelectedTables(new Map())
      loadSources()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '批量添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.post('/import/feishu-sync')
      toast.success('同步任务已触发，正在同步中...')
      setPolling(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '触发失败')
      setSyncing(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此数据源？')) return
    try {
      await api.delete(`/import/feishu-source/${id}`)
      toast.success('已删除')
      loadSources()
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleDiscover}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
        >
          <Search size={16} />
          添加数据源
        </button>
        <button
          onClick={handleSync}
          disabled={syncing || sources.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          触发同步
        </button>
      </div>

      {/* 发现面板 */}
      {showDiscover && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">选择飞书多维表格</h3>
            <button
              onClick={() => setShowDiscover(false)}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              关闭
            </button>
          </div>

          {discovering ? (
            <div className="py-12 text-center text-gray-400">
              <RefreshCw size={24} className="animate-spin mx-auto mb-3" />
              正在查询飞书多维表格...
            </div>
          ) : bitableApps.length === 0 ? (
            <div className="py-12 text-center text-gray-400">未发现可用的多维表格</div>
          ) : (
            <>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <button onClick={toggleSelectAll} className="text-indigo-600 hover:text-indigo-700">
                  {selectedTables.size > 0 ? '取消全选' : '全选'}
                </button>
                <span>已选 {selectedTables.size} 个表</span>
              </div>

              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {bitableApps.map((app) => (
                  <div key={app.app_token}>
                    {/* 应用行 */}
                    <div
                      className="flex items-center gap-2 px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
                      onClick={() => toggleApp(app.app_token)}
                    >
                      {loadingTables.has(app.app_token) ? <Loader2 size={16} className="text-indigo-500 animate-spin" /> : expandedApps.has(app.app_token) ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                      <span className="font-medium text-gray-700">{app.app_name}</span>
                      <span className="text-xs text-gray-400 font-mono">({app.app_token.slice(0, 10)}...)</span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {app.tables.length > 0 ? `${app.tables.length} 个表` : '点击展开'}
                      </span>
                    </div>

                    {/* 子表列表 */}
                    {expandedApps.has(app.app_token) && loadingTables.has(app.app_token) && (
                      <div className="px-10 py-4 text-center text-gray-400 text-sm">
                        <Loader2 size={16} className="animate-spin inline mr-2" />
                        加载数据表中...
                      </div>
                    )}
                    {expandedApps.has(app.app_token) && !loadingTables.has(app.app_token) && app.tables.map((table) => {
                      const key = tableKey(app.app_token, table.table_id)
                      const isExisting = existingKeys.has(key)
                      const isSelected = selectedTables.has(key)
                      const selected = selectedTables.get(key)

                      return (
                        <div
                          key={key}
                          className={`flex items-center gap-3 px-4 py-2.5 pl-10 ${isExisting ? 'opacity-50' : 'hover:bg-indigo-50 cursor-pointer'}`}
                          onClick={() => toggleTable(app.app_token, table)}
                        >
                          {/* 复选框 */}
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                            isExisting ? 'bg-gray-200 border-gray-300' :
                            isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                          }`}>
                            {(isExisting || isSelected) && <Check size={12} className="text-white" />}
                          </div>

                          <span className="text-sm text-gray-700 flex-1">{table.name}</span>

                          {isExisting ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">已添加</span>
                          ) : isSelected ? (
                            <select
                              className="text-xs px-2 py-1 border border-gray-200 rounded bg-white"
                              value={selected?.asset_type || 'document'}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { e.stopPropagation(); updateAssetType(key, e.target.value) }}
                            >
                              {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleBatchAdd}
                  disabled={selectedTables.size === 0 || submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Plus size={16} />
                  {submitting ? '添加中...' : `确认导入 (${selectedTables.size})`}
                </button>
                <button
                  onClick={() => setShowDiscover(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                >
                  取消
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sources list */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : sources.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">表名</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">同步状态</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">记录数</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium hidden md:table-cell">App Token</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">添加时间</th>
                <th className="text-right py-3 px-4 text-gray-500 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-t border-gray-50">
                  <td className="py-3 px-4 text-gray-800">{s.table_name || s.table_id}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700">
                      {ASSET_TYPE_LABELS[s.asset_type] || s.asset_type}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <SyncStatusBadge status={s.last_sync_status} errorMessage={s.error_message} />
                  </td>
                  <td className="py-3 px-4 text-gray-600">{s.records_synced ?? '-'}</td>
                  <td className="py-3 px-4 text-gray-500 hidden md:table-cell font-mono text-xs">{s.app_token}</td>
                  <td className="py-3 px-4 text-gray-500">{new Date(s.created_at).toLocaleString('zh-CN')}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-12 text-center text-gray-400">暂无数据源，点击上方"添加数据源"开始</div>
        )}
      </div>
    </div>
  )
}

function SyncStatusBadge({ status, errorMessage }: { status?: string | null; errorMessage?: string | null }) {
  if (!status || status === 'idle') {
    return <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-500">未同步</span>
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-600">
        <Loader2 size={12} className="animate-spin" />
        同步中
      </span>
    )
  }
  if (status === 'success') {
    return <span className="px-2 py-1 rounded-full text-xs bg-green-50 text-green-600">成功</span>
  }
  if (status === 'failed') {
    return (
      <span className="px-2 py-1 rounded-full text-xs bg-red-50 text-red-600" title={errorMessage || ''}>
        失败
      </span>
    )
  }
  return <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-500">{status}</span>
}

function FileUploadTab() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const loadFiles = useCallback(() => {
    setLoading(true)
    api.get('/upload/files')
      .then((res) => setFiles(res.data))
      .catch(() => toast.error('加载文件列表失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  const handleUpload = async (file: File) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      await api.post('/upload/file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success(`${file.name} 上传成功`)
      loadFiles()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除文件「${name}」？`)) return
    try {
      await api.delete(`/upload/file/${id}`)
      toast.success('已删除')
      loadFiles()
    } catch {
      toast.error('删除失败')
    }
  }

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-white'
        }`}
      >
        <Upload size={40} className="mx-auto text-gray-400 mb-4" />
        <p className="text-gray-600 mb-2">
          {uploading ? '上传中...' : '拖拽文件到此处，或点击选择文件'}
        </p>
        <p className="text-xs text-gray-400 mb-4">支持 PDF、DOCX、TXT、CSV、XLSX、图片等格式，最大 50MB</p>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm cursor-pointer hover:bg-indigo-700">
          <FileUp size={16} />
          选择文件
          <input type="file" className="hidden" onChange={handleFileSelect} disabled={uploading} />
        </label>
      </div>

      {/* Files list */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <h3 className="px-4 py-3 font-semibold text-gray-700 border-b border-gray-100">已上传文件</h3>
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : files.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">文件名</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">大小</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium hidden md:table-cell">分类</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">上传时间</th>
                <th className="text-right py-3 px-4 text-gray-500 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-gray-50">
                  <td className="py-3 px-4 text-gray-800">{f.title || '未命名'}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 uppercase">
                      {f.file_type || '-'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500">{formatSize(f.file_size)}</td>
                  <td className="py-3 px-4 text-gray-500 hidden md:table-cell">{f.category || '-'}</td>
                  <td className="py-3 px-4 text-gray-500">{new Date(f.created_at).toLocaleString('zh-CN')}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleDelete(f.id, f.title || '未命名')}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-12 text-center text-gray-400">暂无上传文件</div>
        )}
      </div>
    </div>
  )
}
