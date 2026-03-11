import { useEffect, useState, useRef, useCallback } from 'react'
import { UserSearch, Search, Loader2 } from 'lucide-react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
} from 'recharts'
import WidgetContainer from './WidgetContainer'
import api from '../../lib/api'

interface ProfileData {
  entity_id: number | null
  name: string
  mention_count: number
  collaborators: RelItem[]
  items: RelItem[]
  leadership_insight: {
    id: number
    report_markdown: string | null
    dimensions: Record<string, number>
    generated_at: string
  } | null
}

interface RelItem {
  id: number
  name: string
  entity_type: string
  relation_type: string
  weight: number
}

interface SearchSuggestion {
  id: number
  name: string
  entity_type: string
  mention_count: number
}

const DIMENSION_LABELS: Record<string, string> = {
  communication: '沟通偏好',
  decision_making: '决策模式',
  focus_areas: '关注领域',
  meeting_habits: '会议习惯',
  responsiveness: '响应速度',
  collaboration_advice: '沟通建议',
}

const TAG_COLORS: Record<string, string> = {
  collaborators: 'bg-indigo-50 text-indigo-700',
  items: 'bg-amber-50 text-amber-700',
}

const TAG_LABELS: Record<string, string> = {
  collaborators: '合作者',
  items: '关联事项',
}

export default function PersonProfileWidget({
  selectedPersonName,
  onClose,
}: {
  selectedPersonName?: string | null
  onClose?: () => void
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const searchProfile = useCallback(async (name: string) => {
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    setShowSuggestions(false)
    try {
      const res = await api.get('/profile/by-name', { params: { name: name.trim() } })
      setProfile(res.data)
    } catch {
      setError('未找到该人物的画像数据')
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Watch for external person selection
  useEffect(() => {
    if (selectedPersonName) {
      setQuery(selectedPersonName)
      searchProfile(selectedPersonName)
    }
  }, [selectedPersonName, searchProfile])

  const handleInputChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.post('/knowledge-graph/search', {
          query: value,
          entity_type: 'person',
          limit: 5,
        })
        setSuggestions(Array.isArray(res.data) ? res.data : [])
        setShowSuggestions(true)
      } catch {
        setSuggestions([])
      }
    }, 300)
  }

  const selectSuggestion = (s: SearchSuggestion) => {
    setQuery(s.name)
    setShowSuggestions(false)
    searchProfile(s.name)
  }

  const getRadarData = (dimensions: Record<string, number>) =>
    Object.entries(DIMENSION_LABELS).map(([key, label]) => ({
      dimension: label,
      score: dimensions[key] || 0,
      fullMark: 10,
    }))

  return (
    <WidgetContainer
      id="person-profile"
      title="人物360画像"
      icon={<UserSearch size={20} />}
      onClose={onClose}
    >
      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchProfile(query)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder="输入人名搜索..."
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {suggestions.map((s) => (
              <div
                key={s.id}
                onClick={() => selectSuggestion(s)}
                className="px-4 py-2 hover:bg-indigo-50 cursor-pointer text-sm flex items-center justify-between"
              >
                <span className="text-gray-800">{s.name}</span>
                <span className="text-xs text-gray-400">提及 {s.mention_count} 次</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-8 text-sm text-gray-400">{error}</div>
      )}

      {profile && !loading && (
        <div className="space-y-4">
          {/* Name + Mentions */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <span className="text-indigo-700 font-semibold">{profile.name[0]}</span>
            </div>
            <div>
              <p className="font-semibold text-gray-800">{profile.name}</p>
              <p className="text-xs text-gray-400">被提及 {profile.mention_count} 次</p>
            </div>
          </div>

          {/* Radar Chart */}
          {profile.leadership_insight && Object.keys(profile.leadership_insight.dimensions).length > 0 && (
            <div>
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={getRadarData(profile.leadership_insight.dimensions)}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 9 }} />
                  <Radar name="评分" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tags */}
          {(['collaborators', 'items'] as const).map((key) => {
            const items = profile[key]
            if (!items || items.length === 0) return null
            return (
              <div key={key}>
                <p className="text-xs text-gray-500 mb-1">{TAG_LABELS[key]}</p>
                <div className="flex flex-wrap gap-1">
                  {items.slice(0, 8).map((item) => (
                    <span key={item.id} className={`px-2 py-0.5 rounded-full text-xs ${TAG_COLORS[key]}`}>
                      {item.name}
                    </span>
                  ))}
                  {items.length > 8 && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                      +{items.length - 8}
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {/* Leadership report preview */}
          {profile.leadership_insight?.report_markdown && (
            <div>
              <p className="text-xs text-gray-500 mb-1">人物画像分析</p>
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 max-h-24 overflow-hidden relative">
                {profile.leadership_insight.report_markdown.slice(0, 200)}...
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 to-transparent" />
              </div>
            </div>
          )}

          {!profile.leadership_insight && (
            <p className="text-xs text-gray-400 text-center py-2">暂无画像分析数据，请先在人物画像页面生成</p>
          )}
        </div>
      )}

      {!profile && !loading && !error && (
        <div className="text-center py-8 text-sm text-gray-400">输入人名开始搜索</div>
      )}
    </WidgetContainer>
  )
}
