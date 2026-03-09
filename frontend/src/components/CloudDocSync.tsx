import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Search, RefreshCw, Trash2, Plus, FileUp, FileText, FolderOpen,
  Check, Loader2, ChevronDown, X,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

/* ── 类型 ─────────────────────────────────── */

interface CloudDoc {
  token: string
  name: string
  doc_type: string
  modified_time: string | null
  already_imported: boolean
}

interface CloudFolder {
  id: number
  folder_token: string
  folder_name: string
  is_enabled: boolean
  last_sync_time: string | null
  last_sync_status: string
  files_synced: number
  error_message: string | null
  created_at: string
}

const DOC_TYPE_LABELS: Record<string, string> = {
  docx: '云文档',
  doc: '旧版文档',
  file: '文件',
}

/* ── 主组件 ────────────────────────────────── */

interface CloudDocSyncProps {
  onClose: () => void
  onImportComplete?: () => void
}

export default function CloudDocSync({ onClose, onImportComplete }: CloudDocSyncProps) {
  // 手动发现
  const [docs, setDocs] = useState<CloudDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [docSearch, setDocSearch] = useState('')

  // 文件夹同步
  const [folders, setFolders] = useState<CloudFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(true)
  const [folderToken, setFolderToken] = useState('')
  const [folderName, setFolderName] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [syncingFolders, setSyncingFolders] = useState(false)
  const [showFolderSection, setShowFolderSection] = useState(false)

  // 文件夹轮询
  const [folderPolling, setFolderPolling] = useState(false)

  const loadFolders = useCallback(() => {
    api.get('/import/cloud-folders')
      .then((res) => setFolders(res.data))
      .catch(() => toast.error('加载文件夹列表失败'))
      .finally(() => setFoldersLoading(false))
  }, [])

  useEffect(() => { loadFolders() }, [loadFolders])

  // 文件夹同步轮询
  useEffect(() => {
    if (!folderPolling) return
    const timer = setInterval(() => {
      api.get('/import/cloud-folders').then((res) => {
        setFolders(res.data)
        const hasRunning = res.data.some((f: CloudFolder) => f.last_sync_status === 'running')
        if (!hasRunning) {
          setFolderPolling(false)
          setSyncingFolders(false)
          toast.success('文件夹同步完成')
          onImportComplete?.()
        }
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [folderPolling, onImportComplete])

  // 自动加载文档列表
  useEffect(() => {
    handleDiscover()
  }, [])

  // 防抖自动搜索：docSearch 变化 500ms 后重新调 API
  const isFirstDocSearch = useRef(true)
  useEffect(() => {
    if (isFirstDocSearch.current) {
      isFirstDocSearch.current = false
      return
    }
    const timer = setTimeout(() => {
      handleDiscover(docSearch)
    }, 500)
    return () => clearTimeout(timer)
  }, [docSearch])

  const handleDiscover = async (searchKeyword?: string) => {
    setLoading(true)
    setSelectedTokens(new Set())
    try {
      const q = searchKeyword !== undefined ? searchKeyword : docSearch
      const res = await api.get('/import/feishu-docs', { params: q ? { q } : {} })
      setDocs(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '获取云文档列表失败')
    } finally {
      setLoading(false)
    }
  }

  const toggleDoc = (token: string) => {
    setSelectedTokens((prev) => {
      const next = new Set(prev)
      if (next.has(token)) next.delete(token)
      else next.add(token)
      return next
    })
  }

  const toggleSelectAll = () => {
    const selectable = filteredDocs.filter((d) => !d.already_imported)
    if (selectedTokens.size >= selectable.length) {
      setSelectedTokens(new Set())
    } else {
      setSelectedTokens(new Set(selectable.map((d) => d.token)))
    }
  }

  const handleImport = async () => {
    if (selectedTokens.size === 0) {
      toast.error('请选择要导入的文档')
      return
    }
    setImporting(true)
    try {
      const items = docs
        .filter((d) => selectedTokens.has(d.token))
        .map((d) => ({ token: d.token, name: d.name, type: d.doc_type }))
      const res = await api.post('/import/feishu-docs', { items })
      toast.success(`导入完成：${res.data.imported} 个成功，${res.data.skipped} 个跳过，${res.data.failed} 个失败`)
      setSelectedTokens(new Set())
      handleDiscover()
      onImportComplete?.()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handleReimport = async (token: string) => {
    try {
      await api.post(`/import/feishu-docs/${token}/reimport`)
      toast.success('重新导入成功')
      handleDiscover()
      onImportComplete?.()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '重新导入失败')
    }
  }

  const handleAddFolder = async () => {
    if (!folderToken.trim()) {
      toast.error('请输入文件夹 Token')
      return
    }
    setAddingFolder(true)
    try {
      await api.post('/import/cloud-folders', {
        folder_token: folderToken.trim(),
        folder_name: folderName.trim() || folderToken.trim(),
      })
      toast.success('文件夹已添加')
      setFolderToken('')
      setFolderName('')
      loadFolders()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '添加失败')
    } finally {
      setAddingFolder(false)
    }
  }

  const handleDeleteFolder = async (id: number) => {
    if (!confirm('确定删除此文件夹源？')) return
    try {
      await api.delete(`/import/cloud-folders/${id}`)
      toast.success('已删除')
      loadFolders()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleSyncFolders = async () => {
    setSyncingFolders(true)
    try {
      await api.post('/import/cloud-folders/sync')
      toast.success('文件夹同步已触发')
      setFolderPolling(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '触发同步失败')
      setSyncingFolders(false)
    }
  }

  const filteredDocs = docs  // 搜索已在后端完成，直接展示所有结果

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">同步飞书文档</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" title="关闭" aria-label="关闭"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 区域 A: 云文档列表 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-700 flex items-center gap-2">
                <FileText size={16} />
                云文档
              </h4>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDiscover()}
                  disabled={loading}
                  className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Search size={12} />
                  {loading ? '查询中...' : '刷新列表'}
                </button>
                {selectedTokens.size > 0 && (
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 disabled:opacity-50"
                  >
                    {importing ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    {importing ? '导入中...' : `导入选中 (${selectedTokens.size})`}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="输入关键词自动搜索..."
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                />
                {loading && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
              </div>
              {filteredDocs.length > 0 && (
                <button onClick={toggleSelectAll} className="text-xs text-indigo-600 hover:text-indigo-700 whitespace-nowrap">
                  {selectedTokens.size > 0 ? '取消全选' : '全选'}
                </button>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-60 overflow-y-auto">
              {loading ? (
                <div className="py-6 text-center text-gray-400 flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  正在查询飞书云文档...
                </div>
              ) : filteredDocs.length > 0 ? (
                filteredDocs.map((doc) => {
                  const isSelected = selectedTokens.has(doc.token)
                  return (
                    <div
                      key={doc.token}
                      className={`flex items-center gap-3 px-4 py-2.5 ${
                        doc.already_imported ? 'opacity-60' : 'hover:bg-indigo-50 cursor-pointer'
                      }`}
                      onClick={() => !doc.already_imported && toggleDoc(doc.token)}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        doc.already_imported ? 'bg-gray-200 border-gray-300' :
                        isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                      }`}>
                        {(doc.already_imported || isSelected) && <Check size={12} className="text-white" />}
                      </div>
                      {doc.doc_type === 'file' ? (
                        <FileUp size={14} className="text-gray-400 flex-shrink-0" />
                      ) : (
                        <FileText size={14} className="text-indigo-400 flex-shrink-0" />
                      )}
                      <span className="text-sm text-gray-700 flex-1 truncate">{doc.name}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] flex-shrink-0 ${
                        doc.doc_type === 'docx' ? 'bg-indigo-50 text-indigo-600' :
                        doc.doc_type === 'file' ? 'bg-amber-50 text-amber-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                      </span>
                      {doc.already_imported && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600">已导入</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReimport(doc.token) }}
                            className="text-[10px] text-indigo-500 hover:text-indigo-700"
                          >
                            重新导入
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="py-4 text-center text-gray-400 text-sm">无匹配结果</div>
              )}
            </div>
          </div>

          {/* 区域 B: 文件夹自动同步（折叠） */}
          <div className="border-t border-gray-100 pt-3">
            <button
              onClick={() => setShowFolderSection(!showFolderSection)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600"
            >
              <ChevronDown size={14} className={`transition-transform ${showFolderSection ? 'rotate-180' : ''}`} />
              <FolderOpen size={14} />
              文件夹自动同步
              {folders.length > 0 && <span className="text-xs text-gray-400 ml-1">({folders.length} 个)</span>}
            </button>

            {showFolderSection && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">文件夹 Token</label>
                    <input
                      type="text"
                      value={folderToken}
                      onChange={(e) => setFolderToken(e.target.value)}
                      placeholder="从飞书文件夹 URL 中获取 token"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="w-36">
                    <label className="block text-xs text-gray-500 mb-1">名称（可选）</label>
                    <input
                      type="text"
                      value={folderName}
                      onChange={(e) => setFolderName(e.target.value)}
                      placeholder="自定义名称"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    onClick={handleAddFolder}
                    disabled={addingFolder}
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Plus size={12} />
                    {addingFolder ? '添加中...' : '添加'}
                  </button>
                </div>

                {foldersLoading ? (
                  <div className="py-3 text-center text-gray-400 text-sm">加载中...</div>
                ) : folders.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <button
                        onClick={handleSyncFolders}
                        disabled={syncingFolders}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={syncingFolders ? 'animate-spin' : ''} />
                        同步全部
                      </button>
                    </div>
                    {folders.map((f) => (
                      <div key={f.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                        <span className="flex-1 text-gray-700">{f.folder_name || f.folder_token}</span>
                        <SyncStatusBadge status={f.last_sync_status} errorMessage={f.error_message} />
                        <span className="text-xs text-gray-400">{f.files_synced} 个文件</span>
                        <button onClick={() => handleDeleteFolder(f.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="删除文件夹" aria-label="删除文件夹">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-3 text-center text-gray-400 text-sm">
                    暂未配置文件夹，添加后可自动同步其中的文档
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

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
