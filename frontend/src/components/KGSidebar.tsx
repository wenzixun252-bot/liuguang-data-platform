import { useEffect, useState } from 'react'
import { Network, ChevronRight, X, FileText, MessageSquare } from 'lucide-react'
import api from '../lib/api'

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

const TYPE_ICONS: Record<string, React.ReactNode> = {
  document: <FileText size={12} className="text-blue-400" />,
  communication: <MessageSquare size={12} className="text-green-400" />,
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

export default function KGSidebar({
  sourceRefs,
  onClose,
}: {
  sourceRefs?: string[]
  onClose?: () => void
}) {
  const [entities, setEntities] = useState<EntityInfo[]>([])
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null)
  const [contentLinks, setContentLinks] = useState<ContentLink[]>([])
  const [loading, setLoading] = useState(false)

  // 从 sourceRefs (如 "document:5") 提取内容关联的实体
  useEffect(() => {
    if (!sourceRefs?.length) return
    const fetchEntities = async () => {
      setLoading(true)
      const allEntities: EntityInfo[] = []
      const seen = new Set<number>()
      for (const ref of sourceRefs.slice(0, 5)) {
        const [contentType, contentId] = ref.split(':')
        if (!contentType || !contentId) continue
        try {
          const { data } = await api.get(`/knowledge-graph/content/${contentType}/${contentId}/entities`)
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
    }
    fetchEntities()
  }, [sourceRefs])

  const handleSelectEntity = async (entityId: number) => {
    setSelectedEntityId(entityId)
    try {
      const { data } = await api.get(`/knowledge-graph/entity/${entityId}/content`)
      setContentLinks(data)
    } catch {
      setContentLinks([])
    }
  }

  if (!sourceRefs?.length && entities.length === 0) return null

  return (
    <div className="bg-gray-900 border-l border-gray-800 w-72 p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <Network size={14} /> 知识图谱关联
        </h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={14} />
          </button>
        )}
      </div>

      {loading && <div className="text-xs text-gray-500">加载中...</div>}

      {/* 实体卡片列表 */}
      {entities.length > 0 && (
        <div className="space-y-1.5">
          {entities.map(e => {
            const color = ENTITY_TYPE_COLORS[e.entity.entity_type] || '#6b7280'
            const isSelected = selectedEntityId === e.entity.id
            return (
              <button
                key={e.entity.id}
                onClick={() => handleSelectEntity(e.entity.id)}
                className={`w-full text-left p-2.5 rounded-lg border transition ${
                  isSelected
                    ? 'bg-gray-800 border-indigo-500'
                    : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm text-white truncate">{e.entity.name}</span>
                  <span className="text-[10px] text-gray-500 ml-auto">{e.entity.entity_type}</span>
                  <ChevronRight size={12} className="text-gray-600" />
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  出现 {e.entity.mention_count} 次 · {e.relation_type}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {entities.length === 0 && !loading && (
        <div className="text-xs text-gray-600 text-center py-4">暂无关联实体</div>
      )}

      {/* 选中实体的关联内容 */}
      {selectedEntityId && contentLinks.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-800 pt-3">
          <div className="text-xs text-gray-400 font-medium">关联内容</div>
          {contentLinks.map((link, i) => (
            <div
              key={`${link.content_type}-${link.content_id}-${i}`}
              className="p-2 bg-gray-800/50 border border-gray-700 rounded-lg"
            >
              <div className="flex items-center gap-1.5">
                {TYPE_ICONS[link.content_type]}
                <span className="text-xs text-white truncate">{link.title}</span>
              </div>
              {link.context_snippet && (
                <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{link.context_snippet}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
