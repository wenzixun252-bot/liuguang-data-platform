import { useCallback, useEffect, useRef, useState } from 'react'
import { Tag, Plus, X, Edit2, Check } from 'lucide-react'
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
  const [tags, setTags] = useState<TagDef[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', category: 'custom', color: '#6366f1', is_shared: false })

  const fetchTags = async () => {
    try {
      const { data } = await api.get('/tags')
      setTags(data)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTags() }, [])

  const handleCreate = async () => {
    if (!form.name.trim()) return toast.error('请输入标签名')
    try {
      await api.post('/tags', form)
      toast.success('标签已创建')
      setShowCreate(false)
      setForm({ name: '', category: 'custom', color: '#6366f1', is_shared: false })
      fetchTags()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '创建失败')
    }
  }

  const handleUpdate = async (id: number) => {
    try {
      await api.put(`/tags/${id}`, form)
      toast.success('已更新')
      setEditingId(null)
      fetchTags()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '更新失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此标签？关联也会一并删除。')) return
    try {
      await api.delete(`/tags/${id}`)
      toast.success('已删除')
      fetchTags()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '删除失败')
    }
  }

  if (loading) return <div className="text-gray-400 text-sm p-4">加载中...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Tag size={16} /> 标签管理
        </h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded flex items-center gap-1"
        >
          <Plus size={12} /> 新建
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
          <input
            placeholder="标签名称"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
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
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={form.is_shared}
              onChange={e => setForm({ ...form, is_shared: e.target.checked })}
            />
            共享给所有人
          </label>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded">创建</button>
            <button onClick={() => setShowCreate(false)} className="text-xs px-3 py-1 bg-gray-200 text-gray-600 rounded">取消</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <div
            key={tag.id}
            className="group flex items-center gap-1 px-2 py-1 rounded-full text-xs"
            style={{ backgroundColor: tag.color + '33', border: `1px solid ${tag.color}` }}
          >
            <span style={{ color: tag.color }}>{tag.name}</span>
            <span className="text-gray-500 text-[10px]">{CATEGORY_LABELS[tag.category] || tag.category}</span>
            {tag.is_shared && <span className="text-[10px] text-gray-500">公开</span>}
            {tag.owner_id && (
              <>
                <button
                  onClick={() => { setEditingId(tag.id); setForm({ name: tag.name, category: tag.category, color: tag.color, is_shared: tag.is_shared }) }}
                  className="opacity-0 group-hover:opacity-100 transition ml-1"
                >
                  <Edit2 size={10} className="text-gray-400 hover:text-gray-700" />
                </button>
                <button
                  onClick={() => handleDelete(tag.id)}
                  className="opacity-0 group-hover:opacity-100 transition"
                >
                  <X size={10} className="text-gray-400 hover:text-red-400" />
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

// ---- 标签 Chips 组件（显示内容的标签） ----
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
  const [allTags, setAllTags] = useState<TagDef[]>([])
  const [showPicker, setShowPicker] = useState(false)

  const fetchContentTags = async () => {
    try {
      const { data } = await api.get(`/tags/content/${contentType}/${contentId}`)
      setTags(data)
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchContentTags() }, [contentType, contentId])

  const handleAttach = async (tagId: number) => {
    try {
      await api.post('/tags/attach', { tag_id: tagId, content_type: contentType, content_id: contentId })
      fetchContentTags()
      setShowPicker(false)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '打标签失败')
    }
  }

  const handleDetach = async (tagId: number) => {
    try {
      await api.delete('/tags/detach', { data: { tag_id: tagId, content_type: contentType, content_id: contentId } })
      fetchContentTags()
    } catch { /* ignore */ }
  }

  const openPicker = async () => {
    try {
      const { data } = await api.get('/tags')
      setAllTags(data)
      setShowPicker(true)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {tags.map(t => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
          style={{ backgroundColor: t.tag_color + '22', color: t.tag_color, border: `1px solid ${t.tag_color}44` }}
        >
          {t.tag_name}
          {editable && (
            <button onClick={() => handleDetach(t.tag_id)}>
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <div className="relative">
          <button onClick={openPicker} className="text-gray-400 hover:text-indigo-500">
            <Plus size={14} />
          </button>
          {showPicker && (
            <div className="absolute z-50 top-6 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[150px] max-h-[200px] overflow-y-auto">
              {allTags
                .filter(t => !tags.some(ct => ct.tag_id === t.id))
                .map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleAttach(t.id)}
                    className="block w-full text-left text-xs px-2 py-1 hover:bg-gray-100 rounded"
                    style={{ color: t.color }}
                  >
                    {t.name}
                  </button>
                ))}
              {allTags.filter(t => !tags.some(ct => ct.tag_id === t.id)).length === 0 && (
                <div className="text-xs text-gray-500 px-2">无更多标签</div>
              )}
              <button onClick={() => setShowPicker(false)} className="text-[10px] text-gray-500 mt-1 w-full text-center">关闭</button>
            </div>
          )}
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
  const [allTags, setAllTags] = useState<TagDef[]>([])

  useEffect(() => {
    api.get('/tags').then(res => setAllTags(res.data)).catch(() => {})
  }, [])

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
      <Tag size={12} className="text-gray-500" />
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

// ---- 快捷标签选择器（带搜索 + 行内快速新建） ----
export function QuickTagSelector({
  selected,
  onChange,
  placeholder = '选择或创建标签...',
}: {
  selected: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
}) {
  const [allTags, setAllTags] = useState<TagDef[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/tags').then(res => setAllTags(res.data)).catch(() => {})
  }, [])

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
      setAllTags(prev => [...prev, data])
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
        className="flex flex-wrap gap-1 items-center min-h-[36px] px-2 py-1 border border-gray-200 rounded-lg cursor-text bg-white"
        onClick={() => setOpen(true)}
      >
        {selected.map(id => {
          const tag = allTags.find(t => t.id === id)
          if (!tag) return null
          return (
            <span
              key={id}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px]"
              style={{ backgroundColor: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
            >
              {tag.name}
              <button onClick={e => { e.stopPropagation(); toggle(id) }}><X size={9} /></button>
            </span>
          )
        })}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
        />
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[220px] max-h-[200px] overflow-y-auto">
            {filtered.map(t => (
              <button
                key={t.id}
                onClick={() => toggle(t.id)}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 hover:bg-gray-50"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                <span className="flex-1" style={{ color: t.color }}>{t.name}</span>
                {selected.includes(t.id) && <Check size={12} className="text-indigo-500" />}
              </button>
            ))}
            {canCreate && (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 hover:bg-indigo-50 text-indigo-600 border-t border-gray-100 disabled:opacity-50"
              >
                <Plus size={12} />
                创建「{search.trim()}」标签
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <div className="text-xs text-gray-400 px-3 py-2">无匹配标签</div>
            )}
          </div>
        </>
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

// ---- 标签选择器（用于上传/数据源配置） ----
export function TagSelector({
  selected,
  onChange,
}: {
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const [allTags, setAllTags] = useState<TagDef[]>([])

  useEffect(() => {
    api.get('/tags').then(res => setAllTags(res.data)).catch(() => {})
  }, [])

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter(t => t !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="flex flex-wrap gap-1">
      {allTags.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => toggle(t.id)}
          className="px-2 py-0.5 rounded-full text-[11px] transition"
          style={{
            backgroundColor: selected.includes(t.id) ? t.color + '44' : 'transparent',
            color: selected.includes(t.id) ? t.color : '#9ca3af',
            border: `1px solid ${selected.includes(t.id) ? t.color : '#d1d5db'}`,
          }}
        >
          {t.name}
        </button>
      ))}
      {allTags.length === 0 && <span className="text-xs text-gray-500">暂无标签</span>}
    </div>
  )
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

// ---- 行内标签编辑器（嵌在表格每一行里） ----
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
  const [allTags, setAllTags] = useState<TagDef[]>([])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const openPicker = async () => {
    try {
      const { data } = await api.get('/tags')
      setAllTags(data)
      setOpen(true)
      setSearch('')
    } catch { /* ignore */ }
  }

  const handleAttach = async (tagId: number) => {
    try {
      await api.post('/tags/attach', { tag_id: tagId, content_type: contentType, content_id: contentId })
      onChanged()
    } catch { /* 已存在则忽略 */ }
  }

  const handleDetach = async (tagId: number) => {
    try {
      await api.delete('/tags/detach', { data: { tag_id: tagId, content_type: contentType, content_id: contentId } })
      onChanged()
    } catch { /* ignore */ }
  }

  const handleCreate = async () => {
    if (!search.trim() || creating) return
    setCreating(true)
    try {
      const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
      const { data } = await api.post('/tags', { name: search.trim(), category: 'custom', color: randomColor })
      setAllTags(prev => [...prev, data])
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
    <div className="flex flex-wrap gap-1 items-center" onClick={e => e.stopPropagation()}>
      {tags.map(t => (
        <span
          key={t.id}
          className="group inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] leading-tight"
          style={{ backgroundColor: t.tag_color + '22', color: t.tag_color, border: `1px solid ${t.tag_color}44` }}
        >
          {t.tag_name}
          <button
            onClick={() => handleDetach(t.tag_id)}
            className="opacity-0 group-hover:opacity-100 transition"
          >
            <X size={8} />
          </button>
        </span>
      ))}
      <div className="relative">
        <button
          onClick={openPicker}
          className="text-gray-300 hover:text-indigo-500 transition"
          title="添加标签"
        >
          <Plus size={12} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute z-50 top-5 left-0 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[180px] max-h-[220px] overflow-hidden flex flex-col">
              <div className="px-2 pt-2 pb-1">
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && canCreate) handleCreate() }}
                  placeholder="搜索或创建..."
                  className="w-full text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-1 focus:ring-indigo-200"
                />
              </div>
              <div className="overflow-y-auto flex-1">
                {filtered.map(t => (
                  <button
                    key={t.id}
                    onClick={() => attachedIds.has(t.id) ? handleDetach(t.id) : handleAttach(t.id)}
                    className="flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 hover:bg-gray-50"
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="flex-1" style={{ color: t.color }}>{t.name}</span>
                    {attachedIds.has(t.id) && <Check size={11} className="text-indigo-500" />}
                  </button>
                ))}
                {canCreate && (
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex items-center gap-2 w-full text-left text-xs px-3 py-1.5 hover:bg-indigo-50 text-indigo-600 border-t border-gray-100 disabled:opacity-50"
                  >
                    <Plus size={11} />
                    创建「{search.trim()}」
                  </button>
                )}
                {filtered.length === 0 && !canCreate && (
                  <div className="text-xs text-gray-400 px-3 py-2">无匹配标签</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
