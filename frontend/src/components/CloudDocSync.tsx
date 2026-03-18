import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, RefreshCw, Trash2, Plus, FileUp, FileText, FolderOpen,
  Check, Loader2, X, ChevronDown, Link, Sparkles,
} from 'lucide-react'
import api, { getExtractionRules } from '../lib/api'
import toast from 'react-hot-toast'

/* ── 类型 ─────────────────────────────────── */

interface CloudDoc {
  token: string
  name: string
  doc_type: string
  owner_id?: string
  owner_name?: string
  modified_time: string | null
  already_imported: boolean
}

interface CloudFolder {
  id: number
  folder_token: string
  folder_name: string
  is_enabled: boolean
  extraction_rule_id: number | null
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

// 沟通数据关键词（匹配标题时推荐归类为沟通数据）
const COMM_KEYWORDS = ['纪要', '会议', '记录', '摘要', '沟通', '对话', '讨论', '录音', '转写', '智能纪要', '文字记录', 'meeting', 'minutes', 'transcript']

function suggestCategory(docName: string): 'communication' | 'document' {
  const lower = docName.toLowerCase()
  return COMM_KEYWORDS.some(k => lower.includes(k)) ? 'communication' : 'document'
}

const CATEGORY_LABELS = {
  communication: { label: '沟通数据', className: 'bg-purple-50 text-purple-600 border-purple-200' },
  document: { label: '文档数据', className: 'bg-blue-50 text-blue-600 border-blue-200' },
} as const

type ImportMode = 'cloud-doc' | 'folder-sync'

/* ── 主组件 ────────────────────────────────── */

type ImportTarget = 'document' | 'communication'

interface CloudDocSyncProps {
  onClose: () => void
  onImportComplete?: () => void
  initialMode?: ImportMode
  targetTable?: ImportTarget
  extractionRuleId?: number | null
}

export default function CloudDocSync({ onClose, onImportComplete, initialMode = 'cloud-doc', targetTable = 'document', extractionRuleId: externalRuleId = null }: CloudDocSyncProps) {
  const isCommMode = targetTable === 'communication'
  const [activeMode, setActiveMode] = useState<ImportMode>(initialMode)

  // 提取规则：云文档导入使用外部传入的；文件夹级别有独立的下拉选择
  const extractionRuleId = externalRuleId
  const { data: extractionRules = [] } = useQuery({ queryKey: ['extraction-rules'], queryFn: getExtractionRules })

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

  // 文件夹自动发现
  const [discoveredFolders, setDiscoveredFolders] = useState<{ token: string; name: string }[]>([])
  const [discoveringFolders, setDiscoveringFolders] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)

  // 文件夹轮询
  const [folderPolling, setFolderPolling] = useState(false)

  // 粘贴链接导入
  const [showPasteUrl, setShowPasteUrl] = useState(false)
  const [pasteUrl, setPasteUrl] = useState('')
  const [addingFromUrl, setAddingFromUrl] = useState(false)

  const loadFolders = useCallback(() => {
    api.get('/import/cloud-folders')
      .then((res) => setFolders(res.data))
      .catch(() => toast.error('加载文件夹列表失败'))
      .finally(() => setFoldersLoading(false))
  }, [])

  useEffect(() => { loadFolders() }, [loadFolders])

  // mount 时检查：有没有文件夹正在同步
  useEffect(() => {
    api.get('/import/cloud-folders')
      .then((res) => {
        const folders = Array.isArray(res.data) ? res.data : []
        const hasRunning = folders.some((f: CloudFolder) => f.last_sync_status === 'running')
        if (hasRunning) {
          setFolders(folders)
          setSyncingFolders(true)
          setFolderPolling(true)
        }
      })
      .catch(() => {})
  }, [])

  // 文件夹同步轮询
  useEffect(() => {
    if (!folderPolling) return
    const timer = setInterval(() => {
      api.get('/import/cloud-folders').then((res) => {
        const data = Array.isArray(res.data) ? res.data : []
        setFolders(data)
        const hasRunning = data.some((f: CloudFolder) => f.last_sync_status === 'running')
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

  // 自动加载文档列表（沟通数据模式自动搜索关键词）
  useEffect(() => {
    if (isCommMode) {
      setDocSearch('纪要 记录')
      handleDiscover('纪要 记录')
    } else {
      handleDiscover()
    }
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
        .map((d) => ({ token: d.token, name: d.name, type: d.doc_type, owner_id: d.owner_id || '', owner_name: d.owner_name || '' }))
      const endpoint = isCommMode ? '/import/feishu-docs/communication' : '/import/feishu-docs'
      await api.post(endpoint, { items, extraction_rule_id: extractionRuleId })
      const label = isCommMode ? '沟通数据' : '文档'
      toast.success(`${items.length} 个${label}已提交后台导入，稍后可在列表中查看`)
      onImportComplete?.()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '导入失败')
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

  const handleDiscoverFolders = async () => {
    setDiscoveringFolders(true)
    try {
      const res = await api.get('/import/cloud-folders/discover')
      setDiscoveredFolders(res.data)
      if (res.data.length === 0) {
        toast('未发现文件夹，可手动输入链接', { icon: 'ℹ️' })
        setShowManualInput(true)
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '获取文件夹列表失败')
    } finally {
      setDiscoveringFolders(false)
    }
  }

  const handleAddDiscoveredFolder = async (token: string, name: string) => {
    try {
      await api.post('/import/cloud-folders', { folder_token: token, folder_name: name })
      toast.success(`文件夹「${name}」已添加`)
      loadFolders()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '添加失败')
    }
  }

  const extractFolderToken = (url: string): string => {
    const match = url.match(/\/folder\/([a-zA-Z0-9]+)/)
    return match ? match[1] : url.trim()
  }

  const handleAddFolder = async () => {
    const token = extractFolderToken(folderToken)
    if (!token) {
      toast.error('请输入文件夹 Token 或链接')
      return
    }
    setAddingFolder(true)
    try {
      await api.post('/import/cloud-folders', {
        folder_token: token,
        folder_name: folderName.trim() || token,
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

  const handleUpdateFolderRule = async (folderId: number, ruleId: number | null) => {
    try {
      await api.patch(`/import/cloud-folders/${folderId}`, { extraction_rule_id: ruleId })
      loadFolders()
    } catch {
      toast.error('更新提取规则失败')
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

  const handleAddFromUrl = async () => {
    if (!pasteUrl.trim()) { toast.error('请粘贴链接'); return }
    setAddingFromUrl(true)
    try {
      await api.post('/import/feishu-docs/from-url', {
        url: pasteUrl.trim(),
        target: isCommMode ? 'communication' : 'document',
        extraction_rule_id: extractionRuleId,
      })
      const label = isCommMode ? '沟通数据' : '文档'
      toast.success(`已提交后台导入为${label}`)
      setPasteUrl('')
      onImportComplete?.()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '导入失败')
    } finally {
      setAddingFromUrl(false)
    }
  }

  const filteredDocs = docs

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 + 模式切换 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold text-gray-800">{isCommMode ? '导入会议纪要或文字记录' : '导入文档'}</h3>
            {!isCommMode && (
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setActiveMode('cloud-doc')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeMode === 'cloud-doc'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <FileText size={12} className="inline mr-1" />
                云文档导入
              </button>
              <button
                type="button"
                onClick={() => setActiveMode('folder-sync')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeMode === 'folder-sync'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <FolderOpen size={12} className="inline mr-1" />
                云文件夹同步
              </button>
            </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" title="关闭" aria-label="关闭"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* ═══ 模式A: 云文档列表导入 ═══ */}
          {activeMode === 'cloud-doc' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-gray-700 flex items-center gap-2">
                  <FileText size={16} />
                  选择飞书云文档
                </h4>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDiscover()}
                      disabled={loading}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Search size={12} />
                      {loading ? '查询中...' : '刷新列表'}
                    </button>
                    {selectedTokens.size > 0 && (
                      <button
                        type="button"
                        onClick={handleImport}
                        disabled={importing}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 disabled:opacity-50"
                      >
                        {importing ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                        {importing ? '提交中...' : `${isCommMode ? '导入为沟通数据' : '导入选中'} (${selectedTokens.size})`}
                      </button>
                    )}
                  </div>
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

              <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-500 flex items-center gap-2">
                {isCommMode ? (
                  <>
                    <span className="px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 text-[10px]">沟通数据</span>
                    <span>选中的文档将由 AI 智能提取为沟通数据（标题、参与人、结论、待办等），导入后可点击查看原文档</span>
                  </>
                ) : (
                  <>
                    <span className="px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 text-[10px]">沟通数据</span>
                    <span>= 含"纪要/会议/记录/摘要"等关键词</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] ml-2">文档数据</span>
                    <span>= 其他文档</span>
                  </>
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
                    const category = suggestCategory(doc.name)
                    const catStyle = CATEGORY_LABELS[category]
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
                        {doc.owner_name && (
                          <span className="text-[10px] text-gray-400 flex-shrink-0 max-w-[80px] truncate" title={doc.owner_name}>
                            {doc.owner_name}
                          </span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] flex-shrink-0 ${catStyle.className}`}>
                          {catStyle.label}
                        </span>
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
          )}

          {/* ═══ 粘贴链接导入（云文档模式下显示） ═══ */}
          {activeMode === 'cloud-doc' && (
            <div className="border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => setShowPasteUrl(!showPasteUrl)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600"
              >
                <ChevronDown size={14} className={`transition-transform ${showPasteUrl ? 'rotate-180' : ''}`} />
                在列表中找不到？粘贴云文档链接
              </button>
              {showPasteUrl && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    placeholder="https://xxx.feishu.cn/docx/... 或 /wiki/... 或 /file/..."
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
                    <Link size={14} />
                    {addingFromUrl ? '导入中...' : '导入'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ═══ 模式B: 云文件夹同步 ═══ */}
          {activeMode === 'folder-sync' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-gray-700 flex items-center gap-2">
                  <FolderOpen size={16} />
                  云文件夹同步
                </h4>
              </div>

              <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                <p className="font-medium">同步说明</p>
                <p>配置飞书文件夹后，系统会自动同步文件夹下的所有云文档和文件，包括快捷方式指向的原始文档。</p>
              </div>

              {/* 添加文件夹 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDiscoverFolders}
                    disabled={discoveringFolders}
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {discoveringFolders ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    {discoveringFolders ? '检索中...' : '自动检索我的文件夹'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualInput(!showManualInput)}
                    className="text-xs text-gray-500 hover:text-indigo-600"
                  >
                    {showManualInput ? '收起手动输入' : '手动粘贴链接'}
                  </button>
                </div>

                {/* 自动发现的文件夹列表 */}
                {discoveredFolders.length > 0 && (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {discoveredFolders.map((f) => {
                      const alreadyAdded = folders.some(ef => ef.folder_token === f.token)
                      return (
                        <div key={f.token} className="flex items-center gap-3 px-4 py-2 text-sm">
                          <FolderOpen size={14} className="text-amber-500 flex-shrink-0" />
                          <span className="flex-1 text-gray-700 truncate">{f.name}</span>
                          {alreadyAdded ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600">已添加</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleAddDiscoveredFolder(f.token, f.name)}
                              className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100"
                            >
                              添加
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 手动输入 */}
                {showManualInput && (
                  <div className="flex gap-2 items-end bg-gray-50 rounded-lg p-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">文件夹链接或 Token</label>
                      <input
                        type="text"
                        value={folderToken}
                        onChange={(e) => setFolderToken(e.target.value)}
                        placeholder="粘贴飞书文件夹链接或 token"
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                    <div className="w-32">
                      <label className="block text-xs text-gray-500 mb-1">名称（可选）</label>
                      <input
                        type="text"
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        placeholder="自定义名称"
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddFolder}
                      disabled={addingFolder}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Plus size={12} />
                      {addingFolder ? '添加中...' : '添加'}
                    </button>
                  </div>
                )}
              </div>

              {/* 已配置的文件夹列表 */}
              {foldersLoading ? (
                <div className="py-3 text-center text-gray-400 text-sm">加载中...</div>
              ) : folders.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-medium text-gray-700">已配置文件夹</h5>
                    <button
                      onClick={handleSyncFolders}
                      disabled={syncingFolders}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={syncingFolders ? 'animate-spin' : ''} />
                      同步全部
                    </button>
                  </div>
                  {folders.map((f) => {
                    const matchedRule = extractionRules.find((r: any) => r.id === f.extraction_rule_id)
                    return (
                      <div key={f.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                        <FolderOpen size={14} className="text-amber-500 flex-shrink-0" />
                        <span className="flex-1 text-gray-700 truncate">{f.folder_name || f.folder_token}</span>
                        <SyncStatusBadge status={f.last_sync_status} errorMessage={f.error_message} />
                        <span className="text-xs text-gray-400">{f.files_synced} 个文件</span>
                        {matchedRule ? (
                          <span
                            title="点击移除提取规则"
                            onClick={() => handleUpdateFolderRule(f.id, null)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 cursor-pointer hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                          >
                            <Sparkles size={10} />
                            {matchedRule.name}
                            <X size={10} className="opacity-60" />
                          </span>
                        ) : extractionRules.length > 0 ? (
                          <FolderRulePicker
                            rules={extractionRules}
                            onSelect={(ruleId) => handleUpdateFolderRule(f.id, ruleId)}
                          />
                        ) : null}
                        <button onClick={() => handleDeleteFolder(f.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="删除文件夹" aria-label="删除文件夹">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="py-6 text-center text-gray-400 text-sm">
                  暂未配置文件夹，添加后可自动同步其中的文档和快捷方式
                </div>
              )}
            </div>
          )}
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

function FolderRulePicker({ rules, onSelect }: { rules: any[]; onSelect: (id: number) => void }) {
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
