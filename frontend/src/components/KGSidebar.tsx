import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network, ChevronRight, X, FileText, MessageSquare } from 'lucide-react'
import api from '../lib/api'
import type { SourceRef } from './ChatMessages'

interface EntityInfo {
  entity: {
    id: number
    name: string
    entity_type: string
    mention_count: number
    properties: Record<string, unknown>
  }
  relation_type: string
  context_snippet: string | null
}

interface ContentLink {
  content_type: string
  content_id: number
  title: string
  relation_type: string
  context_snippet: string | null
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: '#3b82f6',
  project: '#10b981',
  topic: '#f59e0b',
  organization: '#8b5cf6',
  event: '#ef4444',
  document: '#06b6d4',
  community: '#ec4899',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: '人物',
  project: '项目',
  topic: '话题',
  organization: '组织',
  event: '事件',
  document: '文档',
  community: '社群',
}

export default function KGSidebar({
  sourceRefs,
  onClose,
  onEmpty,
}: {
  sourceRefs?: SourceRef[]
  onClose?: () => void
  onEmpty?: () => void
}) {
  const navigate = useNavigate()
  const [entities, setEntities] = useState<EntityInfo[]>([])
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null)
  const [contentLinks, setContentLinks] = useState<ContentLink[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sourceRefs?.length) return
    const fetchEntities = async () => {
      setLoading(true)
      const allEntities: EntityInfo[] = []
      const seen = new Set<number>()
      for (const ref of sourceRefs.slice(0, 5)) {
        try {
          const { data } = await api.get(`/knowledge-graph/content/${ref.type}/${ref.id}/entities`)
          for (const e of data) {
            if (!seen.has(e.entity.id)) {
              seen.add(e.entity.id)
              allEntities.push(e)
            }
          }
        } catch { /* ignore */ }
      }
      setEntities(allEntities)
      setLoading(false)
      if (allEntities.length === 0) {
        onEmpty?.()
      }
    }
    fetchEntities()
  }, [sourceRefs, onEmpty])

  const handleSelectEntity = async (entityId: number) => {
    setSelectedEntityId(entityId)
    try {
      const { data } = await api.get(`/knowledge-graph/entity/${entityId}/content`)
      setContentLinks(data)
    } catch {
      setContentLinks([])
    }
  }

  const getContentUrl = (link: ContentLink) => {
    switch (link.content_type) {
      case 'document': return `/documents?highlight=${link.content_id}`
      case 'communication': return `/communications?highlight=${link.content_id}`
      default: return '#'
    }
  }

  if (!sourceRefs?.length && entities.length === 0) return null

  return (
    <div className="bg-white border-l border-gray-200 w-72 p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
          <Network size={14} className="text-indigo-500" /> 知识图谱关联
        </h3>
        {onClose && (
          <button type="button" title="关闭" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {loading && <div className="text-xs" style={{ color: 'var(--color-text-quaternary)' }}>加载中...</div>}

      {entities.length > 0 && (
        <div className="space-y-1.5">
          {entities.map(e => {
            const color = ENTITY_TYPE_COLORS[e.entity.entity_type] || '#6b7280'
            const label = ENTITY_TYPE_LABELS[e.entity.entity_type] || e.entity.entity_type
            const isSelected = selectedEntityId === e.entity.id
            return (
              <button
                key={e.entity.id}
                onClick={() => handleSelectEntity(e.entity.id)}
                className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-indigo-50 border-indigo-200'
                    : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{e.entity.name}</span>
                  <span className="text-[10px] ml-auto px-1.5 py-0.5 rounded-md bg-gray-100" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
                  <ChevronRight size={12} className="text-gray-400" />
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-quaternary)' }}>
                  出现 {e.entity.mention_count} 次 · {e.relation_type}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedEntityId && contentLinks.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-200 pt-3">
          <div className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>关联内容</div>
          {contentLinks.map((link, i) => (
            <button
              key={`${link.content_type}-${link.content_id}-${i}`}
              onClick={() => navigate(getContentUrl(link))}
              className="w-full text-left p-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {link.content_type === 'document'
                  ? <FileText size={12} className="text-indigo-500 flex-shrink-0" />
                  : <MessageSquare size={12} className="text-emerald-500 flex-shrink-0" />
                }
                <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{link.title}</span>
              </div>
              {link.context_snippet && (
                <p className="text-[10px] mt-1 line-clamp-2" style={{ color: 'var(--color-text-quaternary)' }}>{link.context_snippet}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
