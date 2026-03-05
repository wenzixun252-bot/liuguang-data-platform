import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FileText, Calendar, MessageSquare, Database, Network } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { TagFilter } from './TagManager'

interface TagInfo {
  tag_id: number
  name: string
  color: string
}

interface SearchResultItem {
  id: number
  title: string
  content_preview: string
  source_type: string
  created_at: string | null
  entity_type: string | null
  mention_count: number | null
  tags: TagInfo[]
}

interface SearchResponse {
  keyword: string
  entities: SearchResultItem[]
  data_items: SearchResultItem[]
  total: number
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  document: <FileText size={14} className="text-blue-500" />,
  meeting: <Calendar size={14} className="text-green-500" />,
  chat_message: <MessageSquare size={14} className="text-purple-500" />,
  structured_table: <Database size={14} className="text-orange-500" />,
  kg_entity: <Network size={14} className="text-indigo-500" />,
}

const TYPE_LABELS: Record<string, string> = {
  document: '文档',
  meeting: '会议',
  chat_message: '聊天',
  structured_table: '数据表',
  kg_entity: '实体',
}

const CONTENT_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'document', label: '文档' },
  { value: 'meeting', label: '会议' },
  { value: 'chat_message', label: '聊天' },
  { value: 'structured_table', label: '数据表' },
]

export default function GlobalSearch({
  onSelectEntity,
  onNavigate,
}: {
  onSelectEntity?: (entityId: number) => void
  onNavigate?: () => void
}) {
  const navigate = useNavigate()

  const handleItemClick = (item: SearchResultItem) => {
    const routes: Record<string, string> = {
      document: '/documents',
      meeting: '/meetings',
      chat_message: '/messages',
      structured_table: '/structured-tables',
    }
    const route = routes[item.source_type]
    if (route) {
      onNavigate?.()
      navigate(`${route}?highlight=${item.id}`)
    }
  }
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [tagFilter, setTagFilter] = useState<number[]>([])
  const [typeFilter, setTypeFilter] = useState('')

  const doSearch = async (overrideTagIds?: number[]) => {
    const tags = overrideTagIds ?? tagFilter
    if (!keyword.trim() && tags.length === 0) return
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (keyword.trim()) params.q = keyword.trim()
      if (tags.length) params.tag_ids = tags.join(',')
      if (typeFilter) params.content_types = typeFilter
      const { data } = await api.get('/search', { params })
      setResults(data)
    } catch {
      toast.error('搜索失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 搜索框 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文档、会议、聊天、数据表、知识图谱实体..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-lg text-sm text-gray-700 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          {CONTENT_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => doSearch()}
          disabled={loading}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {loading ? '搜索中...' : '搜索'}
        </button>
      </div>

      {/* 标签筛选（选择标签后自动搜索） */}
      <TagFilter selectedTagIds={tagFilter} onChange={(ids) => { setTagFilter(ids); if (ids.length > 0 || keyword.trim()) doSearch(ids) }} />

      {/* 搜索结果 */}
      {results && (
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            共找到 <span className="font-medium text-gray-700">{results.total}</span> 条结果
          </div>

          {/* 实体结果 */}
          {results.entities.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">知识图谱实体</div>
              {results.entities.map(e => (
                <button
                  key={`entity-${e.id}`}
                  onClick={() => onSelectEntity?.(e.id)}
                  className="w-full text-left p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition"
                >
                  <div className="flex items-center gap-2">
                    {TYPE_ICONS[e.source_type]}
                    <span className="text-sm font-medium text-gray-900">{e.title}</span>
                    <span className="text-xs text-gray-500">{e.content_preview}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* 内容结果 */}
          {results.data_items.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">内容数据</div>
              {results.data_items.map(item => (
                <button
                  key={`${item.source_type}-${item.id}`}
                  onClick={() => handleItemClick(item)}
                  className="w-full text-left p-4 bg-white border border-gray-200 rounded-lg hover:shadow-sm hover:border-indigo-200 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {TYPE_ICONS[item.source_type]}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                      {TYPE_LABELS[item.source_type] || item.source_type}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">{item.title}</span>
                    {item.created_at && (
                      <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
                        {new Date(item.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2">{item.content_preview}</p>
                  {item.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {item.tags.map(t => (
                        <span
                          key={t.tag_id}
                          className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ backgroundColor: t.color + '18', color: t.color, border: `1px solid ${t.color}33` }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {results.total === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">未找到相关结果，试试换个关键词</div>
          )}
        </div>
      )}
    </div>
  )
}
