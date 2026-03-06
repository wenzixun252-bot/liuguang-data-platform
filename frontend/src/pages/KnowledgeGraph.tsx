import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Search, RefreshCw, X, Loader2, Info, AlertTriangle, Lightbulb,
  ZoomIn, ZoomOut, Maximize2, FileText, ExternalLink, Download, Paperclip,
} from 'lucide-react'
import * as d3 from 'd3'
import api from '../lib/api'
import toast from 'react-hot-toast'

// ── 类型定义 ──

interface KGNode {
  id: number
  name: string
  entity_type: string
  mention_count: number
  community_id: number | null
  properties: Record<string, unknown>
  first_seen_at: string | null
  last_seen_at: string | null
}

interface KGEdge {
  id: number
  source_entity_id: number
  target_entity_id: number
  relation_type: string
  weight: number
}

interface KGStats {
  total_entities: number
  total_relations: number
  entity_type_counts: Record<string, number>
}

interface CommunityInfo {
  community_id: number
  member_count: number
  top_entities: string[]
  label: string
}

interface InsightItem {
  title: string
  description: string
  type: 'insight' | 'risk'
  severity: 'high' | 'medium' | 'low'
  related_entity_ids: number[]
}

interface AnalysisResult {
  communities: CommunityInfo[]
  insights: InsightItem[]
  risks: InsightItem[]
}

interface LinkedAsset {
  id: number
  title: string
  source_type: string
  asset_type: 'document' | 'meeting'
}

interface AttachmentMeta {
  file_token: string
  name: string
  size: number
  type: string
}

interface LinkMeta {
  field_name: string
  text: string
  link: string
}

interface DocumentDetail {
  id: number
  owner_id: string
  title: string | null
  source_type: string
  content_text: string
  summary: string | null
  author: string | null
  category: string | null
  file_type: string | null
  tags: Record<string, unknown>
  source_url: string | null
  uploader_name: string | null
  extra_fields?: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  bitable_url: string | null
  synced_at: string | null
  created_at: string
}

interface MeetingDetailData {
  id: number
  title: string | null
  meeting_time: string | null
  duration_minutes: number | null
  location: string | null
  organizer: string | null
  participants: { name?: string; open_id?: string }[]
  agenda: string | null
  conclusions: string | null
  action_items: { task?: string; assignee?: string; deadline?: string }[]
  content_text: string
  source_url: string | null
  uploader_name: string | null
  extra_fields?: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  bitable_url: string | null
  synced_at: string | null
  created_at: string
}

interface ProfileData {
  entity_id: number | null
  name: string
  mention_count: number
  collaborators: { id: number; name: string; entity_type: string; relation_type: string; weight: number }[]
  projects: { id: number; name: string; entity_type: string; relation_type: string; weight: number }[]
  topics: { id: number; name: string; entity_type: string; relation_type: string; weight: number }[]
  organizations: { id: number; name: string; entity_type: string; relation_type: string; weight: number }[]
  communities: { id: number; name: string; entity_type: string; relation_type: string; weight: number }[]
  leadership_insight: {
    id: number
    report_markdown: string | null
    dimensions: Record<string, unknown>
    generated_at: string
  } | null
}

// D3 力模型中使用的节点/边类型
interface SimNode extends d3.SimulationNodeDatum {
  id: number
  name: string
  entity_type: string
  mention_count: number
  community_id: number | null
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: number
  relation_type: string
  weight: number
  source_entity_id: number
  target_entity_id: number
}

// ── 常量 ──

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
  community: '社群',
}

const RELATION_LABELS: Record<string, string> = {
  collaborates_with: '合作',
  works_on: '参与',
  discusses: '讨论',
  belongs_to: '隶属',
  related_to: '关联',
}

const COMMUNITY_COLORS = d3.schemeTableau10

const SEVERITY_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  medium: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  low: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  cloud: '云文档',
  local: '本地文档',
}

// ── 组件 ──

export default function KnowledgeGraph({ embedded = false }: { embedded?: boolean } = {}) {
  const [nodes, setNodes] = useState<KGNode[]>([])
  const [edges, setEdges] = useState<KGEdge[]>([])
  const [stats, setStats] = useState<KGStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null)
  const [selectedRelations, setSelectedRelations] = useState<KGEdge[]>([])
  const [relatedNodes, setRelatedNodes] = useState<KGNode[]>([])
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [communityFilter, setCommunityFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [colorMode, setColorMode] = useState<'type' | 'community'>('type')
  const [rightTab, setRightTab] = useState<'insights' | 'risks'>('insights')
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [linkedAssets, setLinkedAssets] = useState<LinkedAsset[]>([])
  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [, setHoveredNodeId] = useState<number | null>(null)

  const [generatingProfile, setGeneratingProfile] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [assetDetail, setAssetDetail] = useState<DocumentDetail | null>(null)
  const [meetingDetail, setMeetingDetail] = useState<MeetingDetailData | null>(null)
  const [assetModalType, setAssetModalType] = useState<'document' | 'meeting'>('document')
  const [assetLoading, setAssetLoading] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null)

  // ── 获取图谱数据 ──
  const fetchGraph = useCallback(() => {
    setLoading(true)
    const params: Record<string, unknown> = { limit: 500 }
    if (typeFilter) params.entity_type = typeFilter
    if (communityFilter) params.community_id = parseInt(communityFilter)

    // 图谱+统计 是核心请求
    const graphPromise = api.get('/knowledge-graph', { params })
    const statsPromise = api.get('/knowledge-graph/stats')
    // 洞察+风险 独立请求，失败不影响主流程
    const insightsPromise = api.get('/knowledge-graph/insights').catch(() => ({ data: [] }))
    const risksPromise = api.get('/knowledge-graph/risks').catch(() => ({ data: [] }))

    Promise.all([graphPromise, statsPromise, insightsPromise, risksPromise])
      .then(([graphRes, statsRes, insightsRes, risksRes]) => {
        setNodes(graphRes.data.nodes)
        setEdges(graphRes.data.edges)
        setStats(statsRes.data)
        if (statsRes.data.last_analysis_at) {
          setLastAnalysisAt(statsRes.data.last_analysis_at)
        }
        setAnalysisResult({
          communities: graphRes.data.communities || [],
          insights: insightsRes.data || [],
          risks: risksRes.data || [],
        })
      })
      .catch(() => toast.error('加载图谱失败'))
      .finally(() => setLoading(false))
  }, [typeFilter, communityFilter])

  useEffect(() => { fetchGraph() }, [fetchGraph])

  // ── D3 力模型渲染 ──
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return

    const svg = d3.select(svgRef.current)
    const width = svgRef.current.clientWidth || 800
    const height = svgRef.current.clientHeight || 600

    // 清除旧内容
    svg.selectAll('*').remove()

    const container = svg.append('g')

    // 缩放/平移
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        container.attr('transform', event.transform)
      })
    svg.call(zoom)

    // 构建模拟数据
    const simNodes: SimNode[] = nodes.map(n => ({
      id: n.id,
      name: n.name,
      entity_type: n.entity_type,
      mention_count: n.mention_count,
      community_id: n.community_id,
    }))

    const nodeMap = new Map(simNodes.map(n => [n.id, n]))
    const simLinks: SimLink[] = edges
      .filter(e => nodeMap.has(e.source_entity_id) && nodeMap.has(e.target_entity_id))
      .map(e => ({
        id: e.id,
        source: nodeMap.get(e.source_entity_id)!,
        target: nodeMap.get(e.target_entity_id)!,
        relation_type: e.relation_type,
        weight: e.weight,
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
      }))

    // 社群位置 - 将同社群节点拉向同一区域
    const communityIds = [...new Set(simNodes.map(n => n.community_id).filter(c => c !== null))] as number[]
    const commAngle = (id: number) => {
      const idx = communityIds.indexOf(id)
      return (2 * Math.PI * idx) / Math.max(communityIds.length, 1)
    }
    const commRadius = Math.min(width, height) * 0.2

    // 力模型
    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(80).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>().radius(d => getNodeRadius(d) + 5))
      .force('communityX', d3.forceX<SimNode>(d =>
        d.community_id !== null ? width / 2 + commRadius * Math.cos(commAngle(d.community_id)) : width / 2
      ).strength(d => d.community_id !== null ? 0.1 : 0))
      .force('communityY', d3.forceY<SimNode>(d =>
        d.community_id !== null ? height / 2 + commRadius * Math.sin(commAngle(d.community_id)) : height / 2
      ).strength(d => d.community_id !== null ? 0.1 : 0))

    simulationRef.current = simulation

    // 绘制边
    const linkGroup = container.append('g').attr('class', 'links')
    const link = linkGroup.selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', d => Math.max(1, Math.min(4, d.weight)))
      .attr('stroke-opacity', 0.5)

    // 绘制节点
    const nodeGroup = container.append('g').attr('class', 'nodes')
    const node = nodeGroup.selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .attr('cursor', 'pointer')

    node.append('circle')
      .attr('r', d => getNodeRadius(d))
      .attr('fill', d => getNodeColor(d))
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.85)

    node.append('text')
      .text(d => d.name.length > 8 ? d.name.slice(0, 8) + '...' : d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', d => getNodeRadius(d) + 14)
      .attr('font-size', '10px')
      .attr('fill', '#64748b')
      .attr('pointer-events', 'none')
      .attr('user-select', 'none')

    // 拖拽
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })
    node.call(drag)

    // 点击
    node.on('click', (_event, d) => {
      const originalNode = nodes.find(n => n.id === d.id)
      if (originalNode) handleNodeClick(originalNode)
    })

    // 悬停高亮
    const connectedMap = new Map<number, Set<number>>()
    simLinks.forEach(l => {
      const sid = (l.source as SimNode).id
      const tid = (l.target as SimNode).id
      if (!connectedMap.has(sid)) connectedMap.set(sid, new Set())
      if (!connectedMap.has(tid)) connectedMap.set(tid, new Set())
      connectedMap.get(sid)!.add(tid)
      connectedMap.get(tid)!.add(sid)
    })

    node.on('mouseenter', (_event, d) => {
      setHoveredNodeId(d.id)
      const connected = connectedMap.get(d.id) ?? new Set()
      node.select('circle')
        .attr('opacity', (n: SimNode) => n.id === d.id || connected.has(n.id) ? 1 : 0.15)
      node.select('text')
        .attr('opacity', (n: SimNode) => n.id === d.id || connected.has(n.id) ? 1 : 0.15)
      link
        .attr('stroke-opacity', (l: SimLink) => {
          const sid = (l.source as SimNode).id
          const tid = (l.target as SimNode).id
          return sid === d.id || tid === d.id ? 0.8 : 0.05
        })
        .attr('stroke', (l: SimLink) => {
          const sid = (l.source as SimNode).id
          const tid = (l.target as SimNode).id
          return sid === d.id || tid === d.id ? '#6366f1' : '#cbd5e1'
        })
    })

    node.on('mouseleave', () => {
      setHoveredNodeId(null)
      node.select('circle').attr('opacity', 0.85)
      node.select('text').attr('opacity', 1)
      link.attr('stroke-opacity', 0.5).attr('stroke', '#cbd5e1')
    })

    // tick 更新位置
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x ?? 0)
        .attr('y1', d => (d.source as SimNode).y ?? 0)
        .attr('x2', d => (d.target as SimNode).x ?? 0)
        .attr('y2', d => (d.target as SimNode).y ?? 0)

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      simulation.stop()
    }
  }, [nodes, edges, colorMode])

  // ── 节点颜色 ──
  function getNodeColor(d: SimNode | KGNode): string {
    if (colorMode === 'community' && d.community_id !== null) {
      return COMMUNITY_COLORS[d.community_id % COMMUNITY_COLORS.length]
    }
    return ENTITY_COLORS[d.entity_type] || '#94a3b8'
  }

  function getNodeRadius(d: SimNode | KGNode): number {
    return Math.max(8, Math.min(30, 8 + d.mention_count * 2))
  }

  // ── 事件处理 ──

  const handleBuildAndAnalyze = async () => {
    setBuilding(true)
    try {
      const res = await api.post('/knowledge-graph/build-and-analyze')
      setAnalysisResult(res.data.analysis)
      setLastAnalysisAt(new Date().toISOString())
      toast.success('知识图谱生成完成')
      fetchGraph()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '未知错误'
      toast.error(`知识图谱生成失败: ${detail}`)
    } finally {
      setBuilding(false)
    }
  }

  const handleOpenAsset = async (asset: LinkedAsset) => {
    setShowAssetModal(true)
    setAssetLoading(true)
    setAssetDetail(null)
    setMeetingDetail(null)
    setAssetModalType(asset.asset_type)
    try {
      if (asset.asset_type === 'meeting') {
        const res = await api.get(`/meetings/${asset.id}`)
        setMeetingDetail(res.data)
      } else {
        const res = await api.get(`/documents/${asset.id}`)
        setAssetDetail(res.data)
      }
    } catch {
      toast.error('获取详情失败')
      setShowAssetModal(false)
    } finally {
      setAssetLoading(false)
    }
  }

  const handleNodeClick = async (node: KGNode) => {
    setSelectedNode(node)
    setProfileData(null)
    setLinkedAssets([])
    try {
      const res = await api.get(`/knowledge-graph/entities/${node.id}`)
      setSelectedRelations(res.data.relations)
      setRelatedNodes(res.data.related_entities)
    } catch {
      setSelectedRelations([])
      setRelatedNodes([])
    }

    // 加载关联资产
    api.get(`/knowledge-graph/entities/${node.id}/linked-assets`)
      .then(res => setLinkedAssets(res.data))
      .catch(() => setLinkedAssets([]))

    // person 类型加载画像
    if (node.entity_type === 'person') {
      setProfileLoading(true)
      try {
        const res = await api.get(`/profile/by-entity/${node.id}`)
        setProfileData(res.data)
      } catch {
        setProfileData(null)
      } finally {
        setProfileLoading(false)
      }
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchGraph()
      return
    }
    try {
      const res = await api.post('/knowledge-graph/search', {
        query: searchQuery,
        entity_type: typeFilter || null,
        limit: 100,
      })
      setNodes(res.data)
      setEdges([])
    } catch {
      toast.error('搜索失败')
    }
  }

  const handleZoomIn = () => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.transition().duration(300).call(
      d3.zoom<SVGSVGElement, unknown>().scaleBy as any, 1.5
    )
  }

  const handleZoomOut = () => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.transition().duration(300).call(
      d3.zoom<SVGSVGElement, unknown>().scaleBy as any, 0.67
    )
  }

  const handleResetZoom = () => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.transition().duration(500).call(
      d3.zoom<SVGSVGElement, unknown>().transform as any,
      d3.zoomIdentity
    )
  }

  // 高亮某些实体（从洞察/风险卡片点击）
  const highlightEntities = (entityIds: number[]) => {
    if (!svgRef.current) return
    const idSet = new Set(entityIds)
    const svg = d3.select(svgRef.current)
    svg.selectAll('.nodes g circle')
      .attr('opacity', (d: any) => idSet.has(d.id) ? 1 : 0.15)
      .attr('stroke', (d: any) => idSet.has(d.id) ? '#1e1b4b' : 'white')
      .attr('stroke-width', (d: any) => idSet.has(d.id) ? 3 : 1.5)
    svg.selectAll('.nodes g text')
      .attr('opacity', (d: any) => idSet.has(d.id) ? 1 : 0.15)

    // 3 秒后恢复
    setTimeout(() => {
      svg.selectAll('.nodes g circle')
        .attr('opacity', 0.85)
        .attr('stroke', 'white')
        .attr('stroke-width', 1.5)
      svg.selectAll('.nodes g text')
        .attr('opacity', 1)
    }, 3000)
  }

  // 生成/更新画像
  const handleGenerateProfile = async (name: string) => {
    setGeneratingProfile(true)
    try {
      await api.post('/insights/leadership/generate', {
        target_user_id: name,
        target_user_name: name,
      })
      toast.success('画像生成完成')
      // 刷新画像
      if (selectedNode) {
        const res = await api.get(`/profile/by-entity/${selectedNode.id}`)
        setProfileData(res.data)
      }
    } catch {
      toast.error('画像生成失败')
    } finally {
      setGeneratingProfile(false)
    }
  }

  // 获取社群选项
  const communityOptions = analysisResult?.communities ?? []

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {!embedded && <h1 className="text-2xl font-bold text-gray-800">数据图谱</h1>}
        <div className={`flex items-center gap-2 flex-wrap${embedded ? ' w-full' : ''}`}>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索实体..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-44"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">全部类型</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {communityOptions.length > 0 && (
            <select
              value={communityFilter}
              onChange={(e) => setCommunityFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">全部社群</option>
              {communityOptions.map(c => (
                <option key={c.community_id} value={c.community_id}>
                  {c.label} ({c.member_count}人)
                </option>
              ))}
            </select>
          )}
          {lastAnalysisAt && (
            <span className="text-xs text-gray-400">
              上次更新: {new Date(lastAnalysisAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} {new Date(lastAnalysisAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={handleBuildAndAnalyze}
            disabled={building}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
          >
            {building ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {building ? '生成中...' : '生成最新知识图谱'}
          </button>
        </div>
      </div>

      {/* 统计 + 着色切换 */}
      {stats && (
        <div className="flex gap-4 flex-wrap items-center">
          <div className="bg-white rounded-lg shadow-sm px-4 py-2 text-sm">
            <span className="text-gray-500">实体:</span>{' '}
            <span className="font-semibold text-gray-800">{stats.total_entities}</span>
          </div>
          <div className="bg-white rounded-lg shadow-sm px-4 py-2 text-sm">
            <span className="text-gray-500">关系:</span>{' '}
            <span className="font-semibold text-gray-800">{stats.total_relations}</span>
          </div>
          {Object.entries(stats.entity_type_counts).map(([type, count]) => (
            <div key={type} className="bg-white rounded-lg shadow-sm px-4 py-2 text-sm flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ENTITY_COLORS[type] || '#94a3b8' }} />
              <span className="text-gray-500">{ENTITY_LABELS[type] || type}:</span>{' '}
              <span className="font-semibold text-gray-800">{count}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-1 bg-white rounded-lg shadow-sm p-1">
            <button
              onClick={() => setColorMode('type')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${colorMode === 'type' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              按类型着色
            </button>
            <button
              onClick={() => setColorMode('community')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${colorMode === 'community' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              按社群着色
            </button>
          </div>
        </div>
      )}

      {/* 社群图例（社群着色模式下） */}
      {colorMode === 'community' && communityOptions.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {communityOptions.map(c => (
            <div
              key={c.community_id}
              className="flex items-center gap-2 bg-white rounded-lg shadow-sm px-3 py-1.5 text-xs cursor-pointer hover:ring-2 ring-indigo-200 transition-all"
              onClick={() => setCommunityFilter(communityFilter === String(c.community_id) ? '' : String(c.community_id))}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: COMMUNITY_COLORS[c.community_id % COMMUNITY_COLORS.length] }}
              />
              <span className="text-gray-700 font-medium">{c.label}</span>
              <span className="text-gray-400">{c.member_count}人</span>
            </div>
          ))}
        </div>
      )}

      {/* 主体区域：左侧详情 + 中间图谱 + 右侧洞察/风险 */}
      <div className="flex gap-4" style={{ height: embedded ? '600px' : 'calc(100vh - 280px)', minHeight: '500px' }}>

        {/* 左侧面板 - 节点详情 */}
        <div className="w-72 bg-white rounded-xl shadow-sm flex flex-col overflow-hidden shrink-0">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">节点详情</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedNode ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800">{selectedNode.name}</h3>
                  <button onClick={() => setSelectedNode(null)} className="p-1 hover:bg-gray-100 rounded">
                    <X size={16} />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ENTITY_COLORS[selectedNode.entity_type] }} />
                  <span className="text-sm text-gray-500">{ENTITY_LABELS[selectedNode.entity_type] || selectedNode.entity_type}</span>
                  {selectedNode.community_id !== null && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{
                      backgroundColor: COMMUNITY_COLORS[selectedNode.community_id % COMMUNITY_COLORS.length] + '22',
                      color: COMMUNITY_COLORS[selectedNode.community_id % COMMUNITY_COLORS.length],
                    }}>
                      社群 {selectedNode.community_id}
                    </span>
                  )}
                  <span className="text-sm text-gray-400 ml-auto">提及 {selectedNode.mention_count} 次</span>
                </div>

                {selectedNode.first_seen_at && (
                  <p className="text-xs text-gray-400">
                    首次出现: {new Date(selectedNode.first_seen_at).toLocaleDateString('zh-CN')}
                  </p>
                )}

                {/* 关联关系 */}
                {selectedRelations.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">关联关系</p>
                    <div className="space-y-2">
                      {selectedRelations.map((rel) => {
                        const otherNodeId = rel.source_entity_id === selectedNode.id ? rel.target_entity_id : rel.source_entity_id
                        const otherNode = relatedNodes.find(n => n.id === otherNodeId)
                        const direction = rel.source_entity_id === selectedNode.id ? '→' : '←'
                        return (
                          <div
                            key={rel.id}
                            className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-100"
                            onClick={() => { if (otherNode) handleNodeClick(otherNode) }}
                          >
                            <span className="text-gray-400">{direction}</span>
                            <span className="text-gray-600">{RELATION_LABELS[rel.relation_type] || rel.relation_type}</span>
                            <span className="font-medium text-gray-800">{otherNode?.name || `#${otherNodeId}`}</span>
                            {rel.weight > 1 && <span className="text-xs text-gray-400 ml-auto">x{rel.weight}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 关联资产 */}
                {linkedAssets.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">关联资产</p>
                    <div className="space-y-1">
                      {linkedAssets.map(asset => (
                        <div
                          key={`${asset.asset_type}-${asset.id}`}
                          onClick={() => handleOpenAsset(asset)}
                          className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded px-2 py-1.5 transition-colors cursor-pointer"
                        >
                          <FileText size={14} className="shrink-0" />
                          <span className="truncate">{asset.title}</span>
                          <span className="text-xs text-gray-400 ml-auto shrink-0">
                            {asset.asset_type === 'meeting' ? '会议' : (SOURCE_TYPE_LABELS[asset.source_type] || asset.source_type)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 员工画像（仅 person 类型） */}
                {selectedNode.entity_type === 'person' && (
                  <div className="border-t border-gray-200 pt-4">
                    <p className="text-sm font-medium text-indigo-700 mb-2">员工画像</p>
                    {profileLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <Loader2 size={14} className="animate-spin" /> 加载画像中...
                      </div>
                    ) : profileData ? (
                      <div className="space-y-3">
                        {profileData.collaborators.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">协作者</p>
                            <div className="flex flex-wrap gap-1">
                              {profileData.collaborators.slice(0, 8).map(c => (
                                <span key={c.id} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">{c.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {profileData.projects.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">参与项目</p>
                            <div className="flex flex-wrap gap-1">
                              {profileData.projects.slice(0, 6).map(p => (
                                <span key={p.id} className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs">{p.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {profileData.topics.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">关注话题</p>
                            <div className="flex flex-wrap gap-1">
                              {profileData.topics.slice(0, 6).map(t => (
                                <span key={t.id} className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs">{t.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {profileData.communities.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">所属社群</p>
                            <div className="flex flex-wrap gap-1">
                              {profileData.communities.slice(0, 6).map(c => (
                                <span key={c.id} className="px-2 py-0.5 bg-pink-50 text-pink-700 rounded-full text-xs">{c.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {profileData.leadership_insight && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">领导力洞察</p>
                            <div className="bg-indigo-50 rounded-lg p-2 text-xs text-gray-700 max-h-32 overflow-y-auto">
                              {profileData.leadership_insight.report_markdown
                                ? profileData.leadership_insight.report_markdown.slice(0, 300) + '...'
                                : '已生成洞察报告'}
                            </div>
                            {profileData.leadership_insight.report_markdown && (
                              <button
                                onClick={() => setShowReportModal(true)}
                                className="mt-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                              >
                                查看完整报告
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">暂无画像数据</p>
                    )}
                    {/* 生成/更新画像按钮 */}
                    <button
                      onClick={() => handleGenerateProfile(selectedNode.name)}
                      disabled={generatingProfile}
                      className="w-full mt-2 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {generatingProfile ? (
                        <><Loader2 size={14} className="animate-spin" /> 生成中...</>
                      ) : (
                        profileData?.leadership_insight ? '更新画像' : '生成画像'
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
                <Info size={24} />
                <p className="text-sm">点击节点查看详情</p>
              </div>
            )}
          </div>
        </div>

        {/* 中间 - 图谱 */}
        <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden relative">
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
            </div>
          ) : nodes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
              <Info size={32} />
              <p>数据正在自动构建中，请稍候刷新</p>
            </div>
          ) : (
            <>
              <svg ref={svgRef} className="w-full h-full" />
              {/* 缩放控制 */}
              <div className="absolute bottom-4 right-4 flex flex-col gap-1">
                <button onClick={handleZoomIn} className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50" title="放大">
                  <ZoomIn size={16} />
                </button>
                <button onClick={handleZoomOut} className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50" title="缩小">
                  <ZoomOut size={16} />
                </button>
                <button onClick={handleResetZoom} className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50" title="重置">
                  <Maximize2 size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* 右侧面板 - 洞察/风险 */}
        <div className="w-72 bg-white rounded-xl shadow-sm flex flex-col overflow-hidden shrink-0">
          {/* Tab 切换 */}
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => setRightTab('insights')}
              className={`flex-1 py-3 text-sm font-medium transition-colors relative ${rightTab === 'insights' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              洞察
              {analysisResult && analysisResult.insights.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">{analysisResult.insights.length}</span>
              )}
            </button>
            <button
              onClick={() => setRightTab('risks')}
              className={`flex-1 py-3 text-sm font-medium transition-colors relative ${rightTab === 'risks' ? 'text-red-600 border-b-2 border-red-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              风险
              {analysisResult && analysisResult.risks.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">{analysisResult.risks.length}</span>
              )}
            </button>
          </div>

          {/* Tab 内容 */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* 洞察 Tab */}
            {rightTab === 'insights' && (
              analysisResult && analysisResult.insights.length > 0 ? (
                <div className="space-y-3">
                  {analysisResult.insights.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-blue-50 border border-blue-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => item.related_entity_ids.length > 0 && highlightEntities(item.related_entity_ids)}
                    >
                      <div className="flex items-start gap-2">
                        <Lightbulb size={16} className="text-blue-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-blue-800">{item.title}</p>
                          <p className="text-xs text-blue-600 mt-1">{item.description}</p>
                          <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs ${SEVERITY_CONFIG[item.severity]?.text || 'text-gray-500'} ${SEVERITY_CONFIG[item.severity]?.bg || 'bg-gray-50'}`}>
                            {item.severity === 'high' ? '重要' : item.severity === 'medium' ? '一般' : '参考'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
                  <Lightbulb size={24} />
                  <p className="text-sm">点击「生成最新知识图谱」按钮生成洞察</p>
                </div>
              )
            )}

            {/* 风险 Tab */}
            {rightTab === 'risks' && (
              analysisResult && analysisResult.risks.length > 0 ? (
                <div className="space-y-3">
                  {analysisResult.risks.map((item, idx) => {
                    const config = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.medium
                    return (
                      <div
                        key={idx}
                        className={`${config.bg} border ${config.border} rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow`}
                        onClick={() => item.related_entity_ids.length > 0 && highlightEntities(item.related_entity_ids)}
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={16} className={`${config.text} mt-0.5 shrink-0`} />
                          <div>
                            <p className={`text-sm font-medium ${config.text}`}>{item.title}</p>
                            <p className={`text-xs mt-1 opacity-80 ${config.text}`}>{item.description}</p>
                            <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs ${config.text} ${config.bg} border ${config.border}`}>
                              {item.severity === 'high' ? '高风险' : item.severity === 'medium' ? '中风险' : '低风险'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
                  <AlertTriangle size={24} />
                  <p className="text-sm">点击「生成最新知识图谱」按钮检测风险</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* 画像完整报告弹窗 */}
      {showReportModal && profileData?.leadership_insight?.report_markdown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowReportModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">{selectedNode?.name} - 画像报告</h3>
              <button onClick={() => setShowReportModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {profileData.leadership_insight.report_markdown}
              </div>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 资产详情弹窗 */}
      {showAssetModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={() => setShowAssetModal(false)}>
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">{assetModalType === 'meeting' ? '会议详情' : '文档详情'}</h2>
              <button onClick={() => setShowAssetModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
            </div>
            {assetLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
              </div>
            ) : assetModalType === 'meeting' && meetingDetail ? (
              /* ── 会议详情 ── */
              <div className="p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-800">{meetingDetail.title || '无标题'}</h3>

                <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                  {meetingDetail.meeting_time && (
                    <span>{new Date(meetingDetail.meeting_time).toLocaleString('zh-CN')}{meetingDetail.duration_minutes ? ` (${meetingDetail.duration_minutes}分钟)` : ''}</span>
                  )}
                  {meetingDetail.location && <span>{meetingDetail.location}</span>}
                </div>

                {meetingDetail.uploader_name && (
                  <div><p className="text-sm text-gray-500">上传人</p><p className="text-sm text-gray-800 font-medium">{meetingDetail.uploader_name}</p></div>
                )}
                {meetingDetail.organizer && (
                  <div><p className="text-sm text-gray-500">组织者</p><p className="text-sm text-gray-800 font-medium">{meetingDetail.organizer}</p></div>
                )}

                {(meetingDetail.source_url || meetingDetail.bitable_url) && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">相关链接</p>
                    <div className="flex flex-wrap gap-2">
                      {meetingDetail.source_url && (
                        <a href={meetingDetail.source_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors">
                          <FileText size={14} /> 查看完整纪要
                        </a>
                      )}
                      {meetingDetail.bitable_url && (
                        <a href={meetingDetail.bitable_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100 transition-colors">
                          <ExternalLink size={14} /> 查看源多维表格
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {meetingDetail.participants.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">参与人</p>
                    <div className="flex flex-wrap gap-2">
                      {meetingDetail.participants.map((p, i) => (
                        <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">{p.name || p.open_id || '未知'}</span>
                      ))}
                    </div>
                  </div>
                )}

                {meetingDetail.agenda && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">议程</p>
                    <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{meetingDetail.agenda}</p>
                  </div>
                )}

                {meetingDetail.conclusions && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">结论</p>
                    <p className="text-sm text-gray-800 bg-green-50 rounded-lg p-3 whitespace-pre-wrap">{meetingDetail.conclusions}</p>
                  </div>
                )}

                {meetingDetail.action_items.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">待办事项</p>
                    <ul className="space-y-2">
                      {meetingDetail.action_items.map((item, i) => (
                        <li key={i} className="text-sm bg-yellow-50 rounded-lg p-3">
                          <p className="text-gray-800">{item.task || '未命名任务'}</p>
                          {item.assignee && <p className="text-gray-500 text-xs mt-1">负责人: {item.assignee}</p>}
                          {item.deadline && <p className="text-gray-500 text-xs">截止: {item.deadline}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="text-sm text-gray-500 mb-1">全文内容</p>
                  <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {meetingDetail.content_text}
                  </div>
                </div>

                {/* 附件和超链接 */}
                {meetingDetail.extra_fields?._attachments && meetingDetail.extra_fields._attachments.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><Paperclip size={14} /> 附件</p>
                    <div className="grid grid-cols-2 gap-2">
                      {meetingDetail.extra_fields._attachments.map((att) => {
                        const ext = att.name.split('.').pop()?.toLowerCase() || ''
                        const isImg = ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext) || att.type.startsWith('image/')
                        return isImg ? (
                          <div key={att.file_token} className="relative group cursor-pointer" onClick={() => setImagePreview(`/api/upload/attachments/${att.file_token}`)}>
                            <img src={`/api/upload/attachments/${att.file_token}`} alt={att.name} className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                            <p className="text-xs text-gray-500 mt-1 truncate">{att.name}</p>
                          </div>
                        ) : (
                          <a key={att.file_token} href={`/api/upload/attachments/${att.file_token}`} download
                            className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                            <Download size={16} className="text-gray-400 shrink-0" />
                            <span className="text-sm text-gray-700 truncate">{att.name || att.file_token}</span>
                          </a>
                        )
                      })}
                    </div>
                  </div>
                )}
                {meetingDetail.extra_fields?._links && meetingDetail.extra_fields._links.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><ExternalLink size={14} /> 超链接</p>
                    <div className="space-y-1">
                      {meetingDetail.extra_fields._links.map((lnk, i) => (
                        <a key={i} href={lnk.link} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:underline">
                          <ExternalLink size={14} className="shrink-0" />
                          {lnk.text || lnk.field_name || lnk.link}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : assetDetail ? (
              /* ── 文档详情 ── */
              <div className="p-6 space-y-4">
                <div>
                  <p className="text-sm text-gray-500">标题</p>
                  <p className="text-sm text-gray-800 font-medium">{assetDetail.title || '无标题'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">来源</p>
                  <p className="text-sm text-gray-800 font-medium">{SOURCE_TYPE_LABELS[assetDetail.source_type] || assetDetail.source_type}</p>
                </div>
                {assetDetail.uploader_name && (
                  <div><p className="text-sm text-gray-500">上传人</p><p className="text-sm text-gray-800 font-medium">{assetDetail.uploader_name}</p></div>
                )}
                {assetDetail.author && (
                  <div><p className="text-sm text-gray-500">作者</p><p className="text-sm text-gray-800 font-medium">{assetDetail.author}</p></div>
                )}
                {assetDetail.category && (
                  <div><p className="text-sm text-gray-500">分类</p><p className="text-sm text-gray-800 font-medium">{assetDetail.category}</p></div>
                )}
                {assetDetail.file_type && (
                  <div><p className="text-sm text-gray-500">文件类型</p><p className="text-sm text-gray-800 font-medium">{assetDetail.file_type.toUpperCase()}</p></div>
                )}
                <div>
                  <p className="text-sm text-gray-500">时间</p>
                  <p className="text-sm text-gray-800 font-medium">{new Date(assetDetail.synced_at || assetDetail.created_at).toLocaleString('zh-CN')}</p>
                </div>
                {assetDetail.source_type === 'local' && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">文件操作</p>
                    <button
                      onClick={async () => {
                        try {
                          const resp = await api.get(`/documents/${assetDetail.id}/download`, { responseType: 'blob' })
                          const disposition = resp.headers['content-disposition'] || ''
                          const match = disposition.match(/filename="?([^"]+)"?/)
                          const filename = match ? match[1] : assetDetail.title || 'download'
                          const url = URL.createObjectURL(resp.data)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = filename
                          a.click()
                          URL.revokeObjectURL(url)
                        } catch { toast.error('下载失败') }
                      }}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm hover:bg-indigo-100 transition-colors"
                    >
                      <Download size={14} /> 下载文件
                    </button>
                  </div>
                )}
                {assetDetail.source_type === 'cloud' && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">文档链接</p>
                    <div className="flex flex-wrap gap-2">
                      {assetDetail.source_url && (
                        <a href={assetDetail.source_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors">
                          <ExternalLink size={14} /> 在飞书中打开
                        </a>
                      )}
                      {assetDetail.bitable_url && (
                        <a href={assetDetail.bitable_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100 transition-colors">
                          <ExternalLink size={14} /> 查看源多维表格
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {assetDetail.summary && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">摘要</p>
                    <p className="text-sm text-gray-800 bg-blue-50 rounded-lg p-3">{assetDetail.summary}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-500 mb-1">内容</p>
                  <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {assetDetail.content_text}
                  </div>
                </div>
                {assetDetail.tags && Object.keys(assetDetail.tags).length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">标签</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(assetDetail.tags).map((tag) => (
                        <span key={tag} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
                {assetDetail.extra_fields?._attachments && assetDetail.extra_fields._attachments.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><Paperclip size={14} /> 附件</p>
                    <div className="grid grid-cols-2 gap-2">
                      {assetDetail.extra_fields._attachments.map((att) => {
                        const ext = att.name.split('.').pop()?.toLowerCase() || ''
                        const isImg = ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext) || att.type.startsWith('image/')
                        return isImg ? (
                          <div key={att.file_token} className="relative group cursor-pointer" onClick={() => setImagePreview(`/api/upload/attachments/${att.file_token}`)}>
                            <img src={`/api/upload/attachments/${att.file_token}`} alt={att.name} className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                            <p className="text-xs text-gray-500 mt-1 truncate">{att.name}</p>
                          </div>
                        ) : (
                          <a key={att.file_token} href={`/api/upload/attachments/${att.file_token}`} download
                            className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                            <Download size={16} className="text-gray-400 shrink-0" />
                            <span className="text-sm text-gray-700 truncate">{att.name || att.file_token}</span>
                          </a>
                        )
                      })}
                    </div>
                  </div>
                )}
                {assetDetail.extra_fields?._links && assetDetail.extra_fields._links.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><ExternalLink size={14} /> 超链接</p>
                    <div className="space-y-1">
                      {assetDetail.extra_fields._links.map((lnk, i) => (
                        <a key={i} href={lnk.link} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:underline">
                          <ExternalLink size={14} className="shrink-0" />
                          {lnk.text || lnk.field_name || lnk.link}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 图片预览 */}
      {imagePreview && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center" onClick={() => setImagePreview(null)}>
          <img src={imagePreview} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  )
}
