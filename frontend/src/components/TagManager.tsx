import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tag, Plus, X, Edit2, Check, Trash2, ListChecks } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface TagDef {
  id: number
  owner_id: string | null
  category: string
  name: string
  color: string
  is_shared: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  project: '项目',
  priority: '优先级',
  topic: '主题',
  custom: '自定义',
}

const PRESET_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4']

// ---- 标签定义管理面板 ----
export function TagManagerPanel() {
  const tags = useTagDefs()
  const [showCreate, setShowCreate] = useState(false)
  const [showBatchCreate, setShowBatchCreate] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', category: 'custom', color: '#6366f1' })
  const [batchForm, setBatchForm] = useState({ names: '', category: 'custom', color: '#6366f1' })
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchCreating, setBatchCreating] = useState(false)

  const handleCreate = async () => {
    if (!form.name.trim()) return toast.error('请输入标签名')
    try {
      await api.post('/tags', { ...form, is_shared: false })
      toast.success('标签已创建')
      setShowCreate(false)
      setForm({ name: '', category: 'custom', color: '#6366f1' })
      fetchTagCache(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '创建失败')
    }
  }

  const handleBatchCreate = async () => {
    const names = batchForm.names.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (names.length === 0) return toast.error('请输入至少一个标签名')
    setBatchCreating(true)
    try {
      const colors = names.map(() => PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)])
      const { data } = await api.post('/tags/batch-create', {
        names,
        category: batchForm.category,
        colors,
      })
      const created = data.length
      const skipped = names.length - created
      toast.success(`已创建 ${created} 个标签${skipped > 0 ? `，${skipped} 个已存在被跳过` : ''}`)
      setShowBatchCreate(false)
      setBatchForm({ names: '', category: 'custom', color: '#6366f1' })
      fetchTagCache(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '批量创建失败')
    } finally {
      setBatchCreating(false)
    }
  }

  const handleUpdate = async (id: number) => {
    try {
      await api.put(`/tags/${id}`, form)
      toast.success('已更新')
      setEditingId(null)
      fetchTagCache(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '更新失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此标签？关联也会一并删除。')) return
    try {
      await api.delete(`/tags/${id}`)
      toast.success('已删除')
      fetchTagCache(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return toast.error('请先选择要删除的标签')
    if (!confirm(`确定删除选中的 ${selectedIds.size} 个标签？关联也会一并删除。`)) return
    setBatchDeleting(true)
    try {
      const { data } = await api.post('/tags/batch-delete', { tag_ids: Array.from(selectedIds) })
      toast.success(`已删除 ${data.deleted} 个标签`)
      setSelectedIds(new Set())
      setBatchMode(false)
      fetchTagCache(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '批量删除失败')
    } finally {
      setBatchDeleting(false)
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 只有自己的标签才能被选中删除
  const ownTags = tags.filter(t => t.owner_id)
  const allOwnSelected = ownTags.length > 0 && ownTags.every(t => selectedIds.has(t.id))

  const toggleSelectAll = () => {
    if (allOwnSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(ownTags.map(t => t.id)))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Tag size={16} /> 标签管理
        </h3>
        <div className="flex items-center gap-2">
          {batchMode ? (
            <>
              <button
                onClick={toggleSelectAll}
                className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded flex items-center gap-1"
              >
                <ListChecks size={12} /> {allOwnSelected ? '取消全选' : '全选'}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0 || batchDeleting}
                className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 size={12} /> {batchDeleting ? '删除中...' : `删除 (${selectedIds.size})`}
              </button>
              <button
                onClick={() => { setBatchMode(false); setSelectedIds(new Set()) }}
                className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setBatchMode(true)}
                className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded flex items-center gap-1"
              >
                <ListChecks size={12} /> 批量管理
              </button>
              <button
                onClick={() => { setShowBatchCreate(!showBatchCreate); setShowCreate(false) }}
                className="text-xs px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded flex items-center gap-1"
              >
                <Plus size={12} /> 批量添加
              </button>
              <button
                onClick={() => { setShowCreate(!showCreate); setShowBatchCreate(false) }}
                className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded flex items-center gap-1"
              >
                <Plus size={12} /> 新建
              </button>
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
          <input
            placeholder="标签名称"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            className="w-full bg-white text-sm text-gray-900 rounded px-2 py-1.5 border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <div className="flex gap-2 items-center">
            <select
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              className="bg-white text-sm text-gray-700 rounded px-2 py-1 border border-gray-200"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex gap-1">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className="w-5 h-5 rounded-full border-2"
                  style={{ backgroundColor: c, borderColor: form.color === c ? '#111827' : 'transparent' }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded">创建</button>
            <button onClick={() => setShowCreate(false)} className="text-xs px-3 py-1 bg-gray-200 text-gray-600 rounded">取消</button>
          </div>
        </div>
      )}

      {showBatchCreate && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
          <div className="text-xs text-gray-500">输入多个标签名，每行一个或用逗号分隔</div>
          <textarea
            placeholder={"标签A\n标签B\n标签C"}
            value={batchForm.names}
            onChange={e => setBatchForm({ ...batchForm, names: e.target.value })}
            rows={4}
            className="w-full bg-white text-sm text-gray-900 rounded px-2 py-1.5 border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
          />
          <div className="flex gap-2 items-center">
            <select
              value={batchForm.category}
              onChange={e => setBatchForm({ ...batchForm, category: e.target.value })}
              className="bg-white text-sm text-gray-700 rounded px-2 py-1 border border-gray-200"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">颜色自动随机分配</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleBatchCreate}
              disabled={batchCreating}
              className="text-xs px-3 py-1 bg-indigo-600 text-white rounded disabled:opacity-50"
            >
              {batchCreating ? '创建中...' : '批量创建'}
            </button>
            <button onClick={() => setShowBatchCreate(false)} className="text-xs px-3 py-1 bg-gray-200 text-gray-600 rounded">取消</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <div
            key={tag.id}
            className={`group flex items-center gap-1 px-2 py-1 rounded-full text-xs ${batchMode && tag.owner_id ? 'cursor-pointer' : ''} ${selectedIds.has(tag.id) ? 'ring-2 ring-indigo-400' : ''}`}
            style={{ backgroundColor: tag.color + '33', border: `1px solid ${tag.color}` }}
            onClick={batchMode && tag.owner_id ? () => toggleSelect(tag.id) : undefined}
          >
            {batchMode && tag.owner_id && (
              <input
                type="checkbox"
                checked={selectedIds.has(tag.id)}
                onChange={() => toggleSelect(tag.id)}
                onClick={e => e.stopPropagation()}
                className="w-3 h-3 rounded accent-indigo-600"
              />
            )}
            <span style={{ color: tag.color }}>{tag.name}</span>
            {!batchMode && tag.owner_id && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingId(tag.id); setForm({ name: tag.name, category: tag.category, color: tag.color }) }}
                  className="ml-1 cursor-pointer"
                  type="button"
                >
                  <Edit2 size={10} className="text-gray-400 hover:text-gray-700 transition-colors" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(tag.id) }}
                  className="cursor-pointer"
                  type="button"
                >
                  <X size={10} className="text-gray-400 hover:text-red-400 transition-colors" />
                </button>
              </>
            )}
          </div>
        ))}
        {tags.length === 0 && <span className="text-xs text-gray-500">暂无标签</span>}
      </div>

      {editingId && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
          <div className="text-xs text-gray-500">编辑标签</div>
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full bg-white text-sm text-gray-900 rounded px-2 py-1.5 border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <div className="flex gap-1">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className="w-5 h-5 rounded-full border-2"
                style={{ backgroundColor: c, borderColor: form.color === c ? '#111827' : 'transparent' }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleUpdate(editingId)} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded flex items-center gap-1">
              <Check size={12} /> 保存
            </button>
            <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1 bg-gray-200 text-gray-600 rounded">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 标签 Chips 组件（飞书多选风格，显示内容的标签） ----
export function TagChips({
  contentType,
  contentId,
  editable = false,
}: {
  contentType: string
  contentId: number
  editable?: boolean
}) {
  const [tags, setTags] = useState<ContentTagItem[]>([])
  const allTags = useTagDefs()
  const [showPicker, setShowPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchContentTags = async () => {
    try {
      const { data } = await api.get(`/tags/content/${contentType}/${contentId}`)
      setTags(data)
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchContentTags() }, [contentType, contentId])

  useEffect(() => {
    if (!showPicker) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPicker])

  const handleAttach = async (tagId: number) => {
    try {
      await api.post('/tags/attach', { tag_id: tagId, content_type: contentType, content_id: contentId })
      fetchContentTags()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '打标签失败')
    }
  }

  const handleDetach = async (tagId: number) => {
    try {
      await api.post('/tags/detach', { tag_id: tagId, content_type: contentType, content_id: contentId })
      fetchContentTags()
    } catch { /* ignore */ }
  }

  const openPicker = () => {
    setShowPicker(true)
    setSearch('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleCreate = async () => {
    if (!search.trim() || creating) return
    setCreating(true)
    try {
      const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
      const { data } = await api.post('/tags', { name: search.trim(), category: 'custom', color: randomColor })
      addToTagCache(data)
      await handleAttach(data.id)
      setSearch('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '创建标签失败')
    } finally {
      setCreating(false)
    }
  }

  const attachedIds = new Set(tags.map(t => t.tag_id))
  const filtered = allTags.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()))
  const exactMatch = allTags.some(t => t.name.toLowerCase() === search.trim().toLowerCase())
  const canCreate = search.trim().length > 0 && !exactMatch

  return (
    <div className="relative" ref={containerRef}>
      <div
        className={`flex flex-wrap gap-1 items-center min-h-[28px] cursor-pointer ${editable ? 'hover:bg-gray-50 rounded px-1 py-0.5 -mx-1 transition-colors' : ''}`}
        onClick={editable ? openPicker : undefined}
      >
        {tags.map(t => (
          <span
            key={t.id}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium"
            style={{ backgroundColor: t.tag_color + '20', color: t.tag_color }}
          >
            {t.tag_name}
            {editable && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDetach(t.tag_id) }}
                className="p-0.5 rounded hover:bg-black/10 transition-colors cursor-pointer"
                type="button"
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && editable && (
          <span className="text-xs text-gray-300">选择标签</span>
        )}
      </div>
      {showPicker && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[220px] max-h-[280px] overflow-hidden flex flex-col">
          <div className="px-2 pt-2 pb-1.5 border-b border-gray-100">
            <input
              ref={inputRef}
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canCreate) handleCreate(); if (e.key === 'Escape') setShowPicker(false) }}
              placeholder="搜索或创建标签..."
              className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 bg-white"
            />
          </div>
          <div className="overflow-y-auto flex-1 py-1">
            {filtered.map(t => {
              const isAttached = attachedIds.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => isAttached ? handleDetach(t.id) : handleAttach(t.id)}
                  className={`flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 transition-colors ${isAttached ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
                >
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                    style={{ backgroundColor: t.color + '20', color: t.color }}
                  >
                    {t.name}
                  </span>
                  <span className="flex-1" />
                  {isAttached && <Check size={14} className="text-indigo-500" />}
                </button>
              )
            })}
            {canCreate && (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 hover:bg-indigo-50 text-indigo-600 border-t border-gray-100 mt-1 disabled:opacity-50"
              >
                <Plus size={12} />
                创建「{search.trim()}」
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <div className="text-xs text-gray-400 px-3 py-2 text-center">无匹配标签</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 标签筛选器 ----
export function TagFilter({
  selectedTagIds,
  onChange,
}: {
  selectedTagIds: number[]
  onChange: (ids: number[]) => void
}) {
  const allTags = useTagDefs()

  const toggle = (id: number) => {
    if (selectedTagIds.includes(id)) {
      onChange(selectedTagIds.filter(t => t !== id))
    } else {
      onChange([...selectedTagIds, id])
    }
  }

  if (allTags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 items-center">
      <Tag size={12} className="text-gray-400 shrink-0" />
      <span className="text-[11px] text-gray-400 shrink-0 mr-0.5">按标签筛选</span>
      {allTags.map(t => (
        <button
          key={t.id}
          onClick={() => toggle(t.id)}
          className="px-2 py-0.5 rounded-full text-[11px] transition"
          style={{
            backgroundColor: selectedTagIds.includes(t.id) ? t.color + '44' : 'transparent',
            color: selectedTagIds.includes(t.id) ? t.color : '#9ca3af',
            border: `1px solid ${selectedTagIds.includes(t.id) ? t.color : '#d1d5db'}`,
          }}
        >
          {t.name}
        </button>
      ))}
      {selectedTagIds.length > 0 && (
        <button onClick={() => onChange([])} className="text-[10px] text-gray-400 hover:text-gray-600 ml-1">清除</button>
      )}
    </div>
  )
}

// ---- 快捷标签选择器（飞书多选风格，带搜索 + 行内快速新建） ----
export function QuickTagSelector({
  selected,
  onChange,
  placeholder = '选择或创建标签...',
}: {
  selected: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
}) {
  const allTags = useTagDefs()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const filtered = allTags.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()))
  const exactMatch = allTags.some(t => t.name.toLowerCase() === search.trim().toLowerCase())
  const canCreate = search.trim().length > 0 && !exactMatch

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(t => t !== id))
    else onChange([...selected, id])
  }

  const handleCreate = async () => {
    if (!search.trim() || creating) return
    setCreating(true)
    try {
      const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
      const { data } = await api.post('/tags', { name: search.trim(), category: 'custom', color: randomColor })
      addToTagCache(data)
      onChange([...selected, data.id])
      setSearch('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '创建标签失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <div
        className={`flex flex-wrap gap-1 items-center min-h-[36px] px-2 py-1 border rounded-lg cursor-text bg-white transition-colors ${open ? 'border-indigo-300 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-gray-300'}`}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
      >
        {selected.map(id => {
          const tag = allTags.find(t => t.id === id)
          if (!tag) return null
          return (
            <span
              key={id}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium"
              style={{ backgroundColor: tag.color + '20', color: tag.color }}
            >
              {tag.name}
              <button
                className="p-0.5 rounded hover:bg-black/10 transition-colors"
                onClick={e => { e.stopPropagation(); toggle(id) }}
                type="button"
              >
                <X size={9} />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter' && canCreate) handleCreate(); if (e.key === 'Escape') setOpen(false) }}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[60px] text-xs outline-none bg-transparent placeholder-gray-400"
        />
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg w-full min-w-[220px] max-h-[220px] overflow-y-auto py-1">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 transition-colors ${selected.includes(t.id) ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
            >
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                style={{ backgroundColor: t.color + '20', color: t.color }}
              >
                {t.name}
              </span>
              <span className="flex-1" />
              {selected.includes(t.id) && <Check size={14} className="text-indigo-500" />}
            </button>
          ))}
          {canCreate && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 hover:bg-indigo-50 text-indigo-600 border-t border-gray-100 mt-1 disabled:opacity-50"
            >
              <Plus size={12} />
              创建「{search.trim()}」
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <div className="text-xs text-gray-400 px-3 py-2 text-center">无匹配标签</div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- 批量打标签工具栏 ----
export function BatchTagBar({
  selectedIds,
  contentType,
  onDone,
}: {
  selectedIds: Set<number>
  contentType: 'document' | 'communication' | 'structured_table'
  onDone: () => void
}) {
  const [mode, setMode] = useState<'add' | 'remove' | null>(null)
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    if (selectedTagIds.length === 0) return toast.error('请选择标签')
    setLoading(true)
    try {
      if (mode === 'add') {
        const res = await api.post('/tags/batch-attach', {
          tag_ids: selectedTagIds,
          content_type: contentType,
          content_ids: Array.from(selectedIds),
        })
        toast.success(`已为 ${selectedIds.size} 条数据添加 ${res.data.attached} 个标签关联`)
      } else {
        const res = await api.post('/tags/batch-detach', {
          tag_ids: selectedTagIds,
          content_type: contentType,
          content_ids: Array.from(selectedIds),
        })
        toast.success(`已移除 ${res.data.detached} 个标签关联`)
      }
      setMode(null)
      setSelectedTagIds([])
      onDone()
    } catch {
      toast.error(mode === 'add' ? '添加标签失败' : '移除标签失败')
    } finally {
      setLoading(false)
    }
  }

  if (mode) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-indigo-700 whitespace-nowrap">
          {mode === 'add' ? `为 ${selectedIds.size} 项添加标签` : `从 ${selectedIds.size} 项移除标签`}：
        </span>
        <div className="w-56">
          <QuickTagSelector selected={selectedTagIds} onChange={setSelectedTagIds} placeholder="选择标签..." />
        </div>
        <button
          onClick={handleConfirm}
          disabled={loading || selectedTagIds.length === 0}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? '处理中...' : '确认'}
        </button>
        <button
          onClick={() => { setMode(null); setSelectedTagIds([]) }}
          className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-xs whitespace-nowrap"
        >
          取消
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setMode('add')}
        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm"
      >
        <Tag size={14} /> 添加标签
      </button>
      <button
        onClick={() => setMode('remove')}
        className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 text-sm"
      >
        <X size={14} /> 移除标签
      </button>
    </>
  )
}

// ---- 标签选择器（用于上传/数据源配置，飞书多选风格） ----
export function TagSelector({
  selected,
  onChange,
  placeholder = '选择标签...',
}: {
  selected: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
}) {
  const allTags = useTagDefs()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(t => t !== id))
    else onChange([...selected, id])
  }

  const handleCreate = async () => {
    if (!search.trim() || creating) return
    setCreating(true)
    try {
      const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
      const { data } = await api.post('/tags', { name: search.trim(), category: 'custom', color: randomColor })
      addToTagCache(data)
      onChange([...selected, data.id])
      setSearch('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '创建标签失败')
    } finally {
      setCreating(false)
    }
  }

  const filtered = allTags.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()))
  const exactMatch = allTags.some(t => t.name.toLowerCase() === search.trim().toLowerCase())
  const canCreate = search.trim().length > 0 && !exactMatch

  return (
    <div className="relative" ref={containerRef}>
      <div
        className={`flex flex-wrap gap-1 items-center min-h-[36px] px-2 py-1 border rounded-lg cursor-text bg-white transition-colors ${open ? 'border-indigo-300 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-gray-300'}`}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
      >
        {selected.map(id => {
          const tag = allTags.find(t => t.id === id)
          if (!tag) return null
          return (
            <span
              key={id}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium"
              style={{ backgroundColor: tag.color + '20', color: tag.color }}
            >
              {tag.name}
              <button
                className="p-0.5 rounded hover:bg-black/10 transition-colors"
                onClick={e => { e.stopPropagation(); toggle(id) }}
                type="button"
              >
                <X size={9} />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter' && canCreate) handleCreate(); if (e.key === 'Escape') setOpen(false) }}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[60px] text-xs outline-none bg-transparent placeholder-gray-400"
        />
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg w-full min-w-[220px] max-h-[220px] overflow-y-auto py-1">
          {filtered.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className={`flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 transition-colors ${selected.includes(t.id) ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
            >
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                style={{ backgroundColor: t.color + '20', color: t.color }}
              >
                {t.name}
              </span>
              <span className="flex-1" />
              {selected.includes(t.id) && <Check size={14} className="text-indigo-500" />}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 hover:bg-indigo-50 text-indigo-600 border-t border-gray-100 mt-1 disabled:opacity-50"
            >
              <Plus size={12} />
              创建「{search.trim()}」
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <div className="text-xs text-gray-400 px-3 py-2 text-center">无匹配标签</div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- 模块级标签缓存（所有组件共享，只请求一次） ----
let _tagCache: TagDef[] = []
let _tagCachePromise: Promise<TagDef[]> | null = null
let _tagCacheListeners: Set<() => void> = new Set()

async function fetchTagCache(force = false): Promise<TagDef[]> {
  if (_tagCache.length > 0 && !force) return _tagCache
  if (_tagCachePromise && !force) return _tagCachePromise
  _tagCachePromise = api.get('/tags').then(res => {
    _tagCache = Array.isArray(res.data) ? res.data : []
    _tagCachePromise = null
    _tagCacheListeners.forEach(fn => fn())
    return _tagCache
  }).catch(() => { _tagCachePromise = null; return _tagCache })
  return _tagCachePromise
}

function addToTagCache(tag: TagDef) {
  _tagCache = [..._tagCache, tag]
  _tagCacheListeners.forEach(fn => fn())
}

/** 获取共享标签列表的 hook，所有调用者共享同一份数据 */
export function useTagDefs() {
  const [tags, setTags] = useState<TagDef[]>(_tagCache)

  useEffect(() => {
    const update = () => setTags([..._tagCache])
    _tagCacheListeners.add(update)
    fetchTagCache().then(() => setTags([..._tagCache]))
    return () => { _tagCacheListeners.delete(update) }
  }, [])

  return tags
}

// 保持向后兼容
export function useAllTags() {
  const allTags = useTagDefs()
  return { allTags, loaded: allTags.length > 0, reloadAllTags: () => fetchTagCache(true), addTag: addToTagCache }
}

// ---- 批量加载标签 hook（给列表页用，一次取回整页数据的标签） ----
export interface ContentTagItem {
  id: number
  tag_id: number
  tag_name: string
  tag_color: string
  content_type: string
  content_id: number
  tagged_by: string
  confidence: number
}

export function useContentTags(
  contentType: string,
  contentIds: number[],
  refreshKey: number = 0,
) {
  const [tagsMap, setTagsMap] = useState<Record<number, ContentTagItem[]>>({})

  const load = useCallback(async () => {
    if (contentIds.length === 0) { setTagsMap({}); return }
    try {
      const { data } = await api.get('/tags/content-batch', {
        params: { content_type: contentType, content_ids: contentIds },
      })
      setTagsMap(data)
    } catch { setTagsMap({}) }
  }, [contentType, contentIds.join(','), refreshKey])

  useEffect(() => { load() }, [load])

  return { tagsMap, reloadTags: load }
}

// ---- 行内标签编辑器（飞书多维表格多选风格，Portal 渲染下拉） ----
export function InlineTagEditor({
  contentType,
  contentId,
  tags,
  onChanged,
}: {
  contentType: string
  contentId: number
  tags: ContentTagItem[]
  onChanged: () => void
}) {
  const allTags = useTagDefs()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // 滚动/resize 时重新定位或关闭
  useEffect(() => {
    if (!open) return
    const reposition = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    const handleScroll = () => setOpen(false)
    // 监听最近的滚动容器
    const scrollParent = triggerRef.current?.closest('.overflow-y-auto, .overflow-auto, [style*="overflow"]')
    scrollParent?.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', reposition)
    return () => {
      scrollParent?.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const openPicker = () => {
    if (open) { setOpen(false); return }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
    setSearch('')
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  const handleAttach = async (tagId: number) => {
    try {
      await api.post('/tags/attach', { tag_id: tagId, content_type: contentType, content_id: contentId })
      onChanged()
    } catch { /* ignore */ }
  }

  const handleDetach = async (tagId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await api.post('/tags/detach', { tag_id: tagId, content_type: contentType, content_id: contentId })
      onChanged()
    } catch (err: any) {
      const detail = err.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : '移除标签失败')
    }
  }

  const handleCreate = async () => {
    if (!search.trim() || creating) return
    setCreating(true)
    try {
      const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
      const { data } = await api.post('/tags', { name: search.trim(), category: 'custom', color: randomColor })
      addToTagCache(data)
      await handleAttach(data.id)
      setSearch('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '创建标签失败')
    } finally {
      setCreating(false)
    }
  }

  const attachedIds = new Set(tags.map(t => t.tag_id))
  const filtered = allTags.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()))
  const exactMatch = allTags.some(t => t.name.toLowerCase() === search.trim().toLowerCase())
  const canCreate = search.trim().length > 0 && !exactMatch

  const dropdown = open && pos ? createPortal(
    <div
      ref={dropdownRef}
      className="fixed bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden flex flex-col"
      style={{ top: pos.top, left: pos.left, width: 260, maxHeight: 300, zIndex: 9999 }}
    >
      <div className="p-2 border-b border-gray-100">
        <input
          ref={inputRef}
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canCreate) handleCreate(); if (e.key === 'Escape') setOpen(false) }}
          placeholder="搜索或输入新标签名..."
          className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 bg-gray-50/80 placeholder-gray-400"
        />
      </div>
      <div className="overflow-y-auto flex-1 py-1">
        {filtered.length > 0 ? filtered.map(t => {
          const isAttached = attachedIds.has(t.id)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => isAttached ? handleDetach(t.id) : handleAttach(t.id)}
              className={`flex items-center gap-2.5 w-full text-left px-3 py-[7px] transition-colors ${isAttached ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}
            >
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium"
                style={{ backgroundColor: t.color + '18', color: t.color }}
              >
                {t.name}
              </span>
              <span className="flex-1" />
              {isAttached && <Check size={14} className="text-indigo-500 shrink-0" />}
            </button>
          )
        }) : !canCreate ? (
          <div className="px-3 py-4 text-center text-xs text-gray-400">暂无标签，输入名称创建</div>
        ) : null}
        {canCreate && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 w-full text-left px-3 py-[7px] hover:bg-indigo-50 text-indigo-600 border-t border-gray-100 disabled:opacity-50"
          >
            <Plus size={13} />
            <span className="text-xs">创建</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-100/60 text-indigo-600">
              {search.trim()}
            </span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <div onClick={e => e.stopPropagation()}>
      <div
        ref={triggerRef}
        onClick={openPicker}
        className={`group/cell flex flex-wrap gap-1 items-center min-h-[28px] px-1.5 py-0.5 -mx-1 rounded cursor-pointer transition-colors ${open ? 'bg-indigo-50/80 ring-1 ring-indigo-300' : 'hover:bg-gray-50'}`}
      >
        {tags.length > 0 ? tags.map(t => (
          <span
            key={t.id}
            className="inline-flex items-center gap-0.5 pl-1.5 pr-1 py-0.5 rounded text-[11px] leading-tight font-medium whitespace-nowrap"
            style={{ backgroundColor: t.tag_color + '18', color: t.tag_color }}
          >
            {t.tag_name}
            <button
              onClick={(e) => handleDetach(t.tag_id, e)}
              className="ml-0.5 p-0.5 rounded hover:bg-black/10 transition-colors cursor-pointer"
              type="button"
            >
              <X size={10} />
            </button>
          </span>
        )) : (
          <Plus size={14} className="text-gray-300 opacity-0 group-hover/cell:opacity-100 transition-opacity" />
        )}
      </div>
      {dropdown}
    </div>
  )
}
