import { useEffect, useState, useCallback } from 'react'
import { Network, Users, Loader2, X, ChevronRight, Search, RefreshCw, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
} from 'recharts'
import WidgetContainer from './WidgetContainer'
import api from '../../lib/api'

interface KGEntity {
  id: number
  name: string
  entity_type: string
  mention_count: number
  community_id: number | null
}

interface CommunityInfo {
  community_id: number
  member_count: number
  top_entities: string[]
  label: string
}

interface RelItem {
  id: number
  name: string
  entity_type: string
  relation_type: string
  weight: number
}

interface ProfileData {
  entity_id: number | null
  name: string
  mention_count: number
  collaborators: RelItem[]
  projects: RelItem[]
  topics: RelItem[]
  organizations: RelItem[]
  communities: RelItem[]
  leadership_insight: {
    id: number
    report_markdown: string | null
    dimensions: Record<string, number>
    generated_at: string
  } | null
}

interface InsightItem {
  title: string
  description: string
  type: 'insight' | 'risk'
  severity: 'high' | 'medium' | 'low'
}

const ENTITY_COLORS: Record<string, string> = {
  person: '#6366f1',
  project: '#f59e0b',
  topic: '#10b981',
  organization: '#8b5cf6',
  event: '#ef4444',
  document: '#3b82f6',
  community: '#ec4899',
}

const ENTITY_LABELS: Record<string, string> = {
  person: '人物',
  project: '项目',
  topic: '主题',
  organization: '组织',
  event: '事件',
  document: '文档',
}

const TAG_COLORS: Record<string, string> = {
  collaborators: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
  projects: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
  topics: 'bg-green-50 text-green-700 hover:bg-green-100',
  organizations: 'bg-purple-50 text-purple-700 hover:bg-purple-100',
  communities: 'bg-pink-50 text-pink-700 hover:bg-pink-100',
}

const TAG_LABELS: Record<string, string> = {
  collaborators: '合作者',
  projects: '项目',
  topics: '话题',
  organizations: '组织',
  communities: '社群',
}

const COMMUNITY_COLORS = [
  'bg-indigo-100 text-indigo-700 hover:bg-indigo-200',
  'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
  'bg-amber-100 text-amber-700 hover:bg-amber-200',
  'bg-pink-100 text-pink-700 hover:bg-pink-200',
  'bg-cyan-100 text-cyan-700 hover:bg-cyan-200',
  'bg-purple-100 text-purple-700 hover:bg-purple-200',
  'bg-rose-100 text-rose-700 hover:bg-rose-200',
  'bg-teal-100 text-teal-700 hover:bg-teal-200',
]

const DIMENSION_LABELS: Record<string, string> = {
  communication: '沟通偏好',
  decision_making: '决策模式',
  focus_areas: '关注领域',
  meeting_habits: '会议习惯',
  responsiveness: '响应速度',
  collaboration_advice: '沟通建议',
}

type TabType = 'people' | 'communities'

export default function DataGraphWidget({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<TabType>('people')
  const [people, setPeople] = useState<KGEntity[]>([])
  const [communities, setCommunities] = useState<CommunityInfo[]>([])
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [risks, setRisks] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)

  // 详情弹窗
  const [detailModal, setDetailModal] = useState<{
    type: 'person' | 'community'
    name: string
    entityId?: number
    communityInfo?: CommunityInfo
  } | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  // 标签点击弹窗
  const [tagDetail, setTagDetail] = useState<{
    type: string
    name: string
    entityId: number
  } | null>(null)
  const [tagProfile, setTagProfile] = useState<ProfileData | null>(null)
  const [tagProfileLoading, setTagProfileLoading] = useState(false)
  // 社群成员弹窗
  const [communityMembers, setCommunityMembers] = useState<KGEntity[]>([])
  const [communityMembersLoading, setCommunityMembersLoading] = useState(false)

  const fetchData = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.allSettled([
      api.get('/knowledge-graph/entities', { params: { entity_type: 'person', page_size: 100 } }),
      api.get('/knowledge-graph/communities'),
      api.get('/knowledge-graph/insights'),
      api.get('/knowledge-graph/risks'),
      api.get('/knowledge-graph/stats'),
    ]).then(([peopleRes, commRes, insightRes, riskRes, statsRes]) => {
      setPeople(peopleRes.status === 'fulfilled' ? peopleRes.value.data : [])
      setCommunities(commRes.status === 'fulfilled' ? commRes.value.data : [])
      setInsights(insightRes.status === 'fulfilled' ? insightRes.value.data : [])
      setRisks(riskRes.status === 'fulfilled' ? riskRes.value.data : [])
      if (statsRes.status === 'fulfilled') {
        setLastAnalysisAt(statsRes.value.data.last_analysis_at || null)
      }
    }).catch(() => setError('加载数据图谱失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // 打开人物详情
  const openPersonDetail = async (entity: KGEntity) => {
    setDetailModal({ type: 'person', name: entity.name, entityId: entity.id })
    setProfile(null)
    setProfileLoading(true)
    try {
      const res = await api.get('/profile/by-name', { params: { name: entity.name } })
      setProfile(res.data)
    } catch {
      setProfile(null)
    } finally {
      setProfileLoading(false)
    }
  }

  // 打开社群详情
  const openCommunityDetail = async (comm: CommunityInfo) => {
    setDetailModal({ type: 'community', name: comm.label, communityInfo: comm })
    setCommunityMembers([])
    setCommunityMembersLoading(true)
    try {
      const res = await api.get('/knowledge-graph', { params: { community_id: comm.community_id, limit: 50 } })
      setCommunityMembers(res.data.nodes || [])
    } catch {
      setCommunityMembers([])
    } finally {
      setCommunityMembersLoading(false)
    }
  }

  // 标签点击 → 查看该标签实体的画像
  const handleTagClick = async (item: RelItem) => {
    setTagDetail({ type: item.entity_type, name: item.name, entityId: item.id })
    setTagProfile(null)
    if (item.entity_type === 'person') {
      setTagProfileLoading(true)
      try {
        const res = await api.get('/profile/by-name', { params: { name: item.name } })
        setTagProfile(res.data)
      } catch {
        setTagProfile(null)
      } finally {
        setTagProfileLoading(false)
      }
    }
  }

  // 轮询图谱构建进度（复用 KnowledgeGraph 页面相同模式）
  const pollBuildStatus = useCallback(async () => {
    setBuilding(true)
    try {
      let done = false
      while (!done) {
        const res = await api.get('/knowledge-graph/build-status')
        const { status } = res.data
        if (status === 'done') {
          toast.success('图谱生成完成')
          fetchData()
          done = true
        } else if (status === 'error') {
          toast.error('图谱生成失败')
          done = true
        } else if (status !== 'running') {
          done = true
        } else {
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    } catch {
      toast.error('查询构建进度失败')
    } finally {
      setBuilding(false)
    }
  }, [fetchData])

  // 页面加载时检查是否有正在运行的构建任务
  useEffect(() => {
    let cancelled = false
    api.get('/knowledge-graph/build-status').then(res => {
      if (!cancelled && res.data.status === 'running') {
        pollBuildStatus()
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [pollBuildStatus])

  // 生成最新图谱
  const handleBuildAndAnalyze = async () => {
    try {
      const startRes = await api.post('/knowledge-graph/build-and-analyze')
      if (startRes.data.status === 'running') {
        toast('构建任务已在运行中', { icon: 'ℹ️' })
      }
      await pollBuildStatus()
    } catch {
      toast.error('图谱生成失败')
      setBuilding(false)
    }
  }

  // 生成/更新画像
  const [generatingProfile, setGeneratingProfile] = useState(false)
  const handleGenerateProfile = async (name: string) => {
    setGeneratingProfile(true)
    try {
      await api.post('/insights/leadership/generate', {
        target_user_id: name,
        target_user_name: name,
      })
      toast.success('画像生成完成')
      // 刷新画像数据
      const res = await api.get('/profile/by-name', { params: { name } })
      setProfile(res.data)
    } catch {
      toast.error('画像生成失败')
    } finally {
      setGeneratingProfile(false)
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const filteredPeople = searchQuery.trim()
    ? people.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : people

  const getRadarData = (dimensions: Record<string, number>) =>
    Object.entries(DIMENSION_LABELS).map(([key, label]) => ({
      dimension: label,
      score: dimensions[key] || 0,
      fullMark: 10,
    }))

  return (
    <WidgetContainer
      id="kg-mini"
      title="数据图谱"
      icon={<Network size={20} />}
      loading={loading}
      error={error}
      onRetry={fetchData}
      onClose={onClose}
      headerExtra={
        <div className="flex items-center gap-2">
          {lastAnalysisAt && (
            <span className="text-xs text-gray-400">更新于 {formatTime(lastAnalysisAt)}</span>
          )}
          <button
            onClick={handleBuildAndAnalyze}
            disabled={building}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          >
            {building ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {building ? '生成中...' : '生成最新图谱'}
          </button>
        </div>
      }
    >
      {/* Tab 切换 */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTab('people')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'people' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users size={15} />
          人物 ({people.length})
        </button>
        <button
          onClick={() => setTab('communities')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'communities' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Network size={15} />
          社群 ({communities.length})
        </button>
      </div>

      {/* 人物列表 */}
      {tab === 'people' && (
        <div>
          {/* 搜索 */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索人物..."
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {filteredPeople.length > 0 ? filteredPeople.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer group transition-colors"
                onClick={() => openPersonDetail(p)}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0"
                  style={{ backgroundColor: ENTITY_COLORS.person }}
                >
                  {p.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400">提及 {p.mention_count} 次</p>
                </div>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 shrink-0" />
              </div>
            )) : (
              <p className="text-center text-sm text-gray-400 py-4">暂无人物数据</p>
            )}
          </div>
        </div>
      )}

      {/* 社群列表 */}
      {tab === 'communities' && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {communities.length > 0 ? communities.map((c, i) => (
            <div
              key={c.community_id}
              className="p-3 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
              onClick={() => openCommunityDetail(c)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${COMMUNITY_COLORS[i % COMMUNITY_COLORS.length]}`}>
                  {c.label}
                </span>
                <span className="text-xs text-gray-400">{c.member_count} 人</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.top_entities.slice(0, 5).map((name, j) => (
                  <span key={j} className="px-2 py-0.5 bg-white rounded text-xs text-gray-600">{name}</span>
                ))}
              </div>
            </div>
          )) : (
            <p className="text-center text-sm text-gray-400 py-4">暂无社群数据，请等待自动构建完成</p>
          )}

          {/* 洞察和风险 */}
          {insights.length > 0 && (
            <div className="pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">关键洞察</p>
              {insights.slice(0, 3).map((item, idx) => (
                <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2">
                  <p className="text-sm font-medium text-blue-800">{item.title}</p>
                  <p className="text-xs text-blue-600 mt-0.5">{item.description}</p>
                </div>
              ))}
            </div>
          )}
          {risks.length > 0 && (
            <div className="pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">风险预警</p>
              {risks.slice(0, 3).map((item, idx) => (
                <div key={idx} className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-2">
                  <p className="text-sm font-medium text-red-800">{item.title}</p>
                  <p className="text-xs text-red-600 mt-0.5">{item.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ 人物/社群详情弹窗 ═══ */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                {detailModal.type === 'person' ? (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
                    style={{ backgroundColor: ENTITY_COLORS.person }}
                  >
                    {detailModal.name[0]}
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center">
                    <Network size={20} className="text-pink-600" />
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">{detailModal.name}</h2>
                  <p className="text-xs text-gray-400">{detailModal.type === 'person' ? '人物画像' : '社群详情'}</p>
                </div>
              </div>
              <button onClick={() => setDetailModal(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto max-h-[calc(85vh-80px)] p-6">
              {detailModal.type === 'person' ? (
                profileLoading ? (
                  <div className="flex items-center justify-center py-12 text-gray-400">
                    <Loader2 size={20} className="animate-spin mr-2" /> 加载画像中...
                  </div>
                ) : profile ? (
                  <div className="space-y-5">
                    {/* 基本信息 */}
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      被提及 <span className="font-semibold text-gray-800">{profile.mention_count}</span> 次
                    </div>

                    {/* 雷达图 */}
                    {profile.leadership_insight && Object.keys(profile.leadership_insight.dimensions).length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">能力画像</p>
                        <ResponsiveContainer width="100%" height={240}>
                          <RadarChart data={getRadarData(profile.leadership_insight.dimensions)}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: '#6b7280' }} />
                            <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 9 }} />
                            <Radar name="评分" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* 标签区 */}
                    {(['collaborators', 'projects', 'topics', 'organizations', 'communities'] as const).map((key) => {
                      const items = profile[key]
                      if (!items || items.length === 0) return null
                      return (
                        <div key={key}>
                          <p className="text-xs text-gray-500 mb-1.5">{TAG_LABELS[key]}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {items.map((item) => (
                              <span
                                key={item.id}
                                onClick={() => handleTagClick(item)}
                                className={`px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors ${TAG_COLORS[key]}`}
                              >
                                {item.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}

                    {/* 领导力报告 */}
                    {profile.leadership_insight?.report_markdown && (
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">领导力报告</p>
                        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {profile.leadership_insight.report_markdown}
                        </div>
                      </div>
                    )}

                    {/* 生成/更新画像按钮 */}
                    <button
                      onClick={() => handleGenerateProfile(profile.name)}
                      disabled={generatingProfile}
                      className="w-full py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {generatingProfile ? (
                        <><Loader2 size={14} className="animate-spin" /> 生成中...</>
                      ) : (
                        <><UserPlus size={14} /> {profile.leadership_insight ? '更新画像' : '生成画像'}</>
                      )}
                    </button>
                  </div>
                ) : (
                  <p className="text-center py-8 text-sm text-gray-400">未找到该人物的画像数据</p>
                )
              ) : (
                /* 社群详情 */
                <div className="space-y-4">
                  {detailModal.communityInfo && (
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      共 <span className="font-semibold text-gray-800">{detailModal.communityInfo.member_count}</span> 名成员
                    </div>
                  )}

                  {/* 核心成员 */}
                  {detailModal.communityInfo?.top_entities && detailModal.communityInfo.top_entities.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">核心成员</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detailModal.communityInfo.top_entities.map((name, i) => (
                          <span key={i} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs">
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 全部成员 */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">全部成员</p>
                    {communityMembersLoading ? (
                      <div className="flex items-center justify-center py-6 text-gray-400">
                        <Loader2 size={16} className="animate-spin mr-2" /> 加载中...
                      </div>
                    ) : communityMembers.length > 0 ? (
                      <div className="space-y-1">
                        {communityMembers.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                            onClick={() => {
                              setDetailModal(null)
                              setTimeout(() => openPersonDetail(m), 200)
                            }}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: ENTITY_COLORS[m.entity_type] || '#94a3b8' }}
                            />
                            <span className="text-sm text-gray-800">{m.name}</span>
                            <span className="text-xs text-gray-400 ml-auto">{ENTITY_LABELS[m.entity_type] || m.entity_type}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-4">暂无成员数据</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ 标签详情弹窗 ═══ */}
      {tagDetail && (
        <div className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center" onClick={() => setTagDetail(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[70vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: ENTITY_COLORS[tagDetail.type] || '#94a3b8' }}
                />
                <h3 className="font-semibold text-gray-800">{tagDetail.name}</h3>
                <span className="text-xs text-gray-400">{ENTITY_LABELS[tagDetail.type] || tagDetail.type}</span>
              </div>
              <button onClick={() => setTagDetail(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(70vh-56px)]">
              {tagDetail.type === 'person' ? (
                tagProfileLoading ? (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <Loader2 size={16} className="animate-spin mr-2" /> 加载中...
                  </div>
                ) : tagProfile ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-500">被提及 {tagProfile.mention_count} 次</p>
                    {(['collaborators', 'projects', 'topics'] as const).map((key) => {
                      const items = tagProfile[key]
                      if (!items || items.length === 0) return null
                      return (
                        <div key={key}>
                          <p className="text-xs text-gray-500 mb-1">{TAG_LABELS[key]}</p>
                          <div className="flex flex-wrap gap-1">
                            {items.slice(0, 6).map((it) => (
                              <span key={it.id} className={`px-2 py-0.5 rounded-full text-xs ${TAG_COLORS[key]}`}>{it.name}</span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    <button
                      onClick={() => {
                        setTagDetail(null)
                        setDetailModal(null)
                        setTimeout(() => {
                          setDetailModal({ type: 'person', name: tagDetail.name, entityId: tagDetail.entityId })
                          setProfile(tagProfile)
                          setProfileLoading(false)
                        }, 200)
                      }}
                      className="w-full mt-2 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
                    >
                      查看完整画像
                    </button>
                  </div>
                ) : (
                  <p className="text-center text-sm text-gray-400 py-4">暂无画像数据</p>
                )
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    类型：<span className="font-medium">{ENTITY_LABELS[tagDetail.type] || tagDetail.type}</span>
                  </p>
                  <p className="text-xs text-gray-400">此实体来自知识图谱，可在知识图谱页面查看更多关联信息。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </WidgetContainer>
  )
}
