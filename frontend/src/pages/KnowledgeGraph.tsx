import { useEffect, useState, useRef, useCallback } from 'react'
import {
  RefreshCw, X, Loader2, Info, AlertTriangle, Lightbulb, Settings,
  ZoomIn, ZoomOut, Maximize2, FileText, ExternalLink, Download, Paperclip, Network, UserSearch,
} from 'lucide-react'
import KGProfileWizard from '../components/KGProfileWizard'
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from 'recharts'
import * as d3 from 'd3'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { useTaskProgress } from '../hooks/useTaskProgress'

// ── 类型定义 ──

interface KGNode {
  id: number
  name: string
  entity_type: string
  mention_count: number
  community_id: number | null
  importance_score: number
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
  domain_label: string
}

interface InsightItem {
  title: string
  description: string
  type: 'insight' | 'risk'
  severity: 'high' | 'medium' | 'low'
  related_entity_ids: number[]
  category: string
  evidence: string
  suggested_action: string
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
  asset_type: 'document' | 'communication'
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
  comm_type: string
  title: string | null
  comm_time: string | null
  duration_minutes: number | null
  location: string | null
  initiator: string | null
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
  entity_type: string
  mention_count: number
  collaborators: { id: number; name: string; entity_type: string; relation_type: string; weight: number }[]
  items: { id: number; name: string; entity_type: string; relation_type: string; weight: number }[]
  leadership_insight: {
    id: number
    report_markdown: string | null
    dimensions: Record<string, unknown>
    data_coverage: Record<string, unknown>
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
  importance_score: number
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: number
  relation_type: string
  weight: number
  source_entity_id: number
  target_entity_id: number
}

// ── 六维雷达图组件 ──

const DIMENSION_LABELS: Record<string, string> = {
  communication: '沟通偏好',
  decision_making: '决策模式',
  focus_areas: '关注领域',
  meeting_habits: '会议习惯',
  responsiveness: '响应速度',
  collaboration_advice: '协作能力',
}

function ProfileRadarChart({ dimensions }: { dimensions: Record<string, number> }) {
  const data = Object.entries(DIMENSION_LABELS).map(([key, label]) => ({
    dimension: label,
    score: typeof dimensions[key] === 'number' ? dimensions[key] : 0,
    fullMark: 10,
  }))

  return (
    <div className="mb-2">
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: '#6b7280' }} />
          <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 8, fill: '#9ca3af' }} axisLine={false} />
          <Radar
            name="评分"
            dataKey="score"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.2}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── 常量 ──

const ENTITY_COLORS: Record<string, string> = {
  person: '#6366f1',
  item: '#f59e0b',
}

const ENTITY_LABELS: Record<string, string> = {
  person: '人物',
  item: '事项',
}

const RISK_CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  project: { label: '项目风险', icon: '📋', color: 'text-orange-700' },
  compliance: { label: '合规风险', icon: '📜', color: 'text-red-700' },
  collaboration: { label: '协作风险', icon: '🤝', color: 'text-blue-700' },
  resource: { label: '资源风险', icon: '⚡', color: 'text-purple-700' },
}

const RELATION_LABELS: Record<string, string> = {
  collaborates_with: '合作',
  involved_in: '参与',
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
  const { addTask, updateTask } = useTaskProgress()
  const [nodes, setNodes] = useState<KGNode[]>([])
  const [edges, setEdges] = useState<KGEdge[]>([])
  const [stats, setStats] = useState<KGStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [buildProgress, setBuildProgress] = useState(0)
  const [buildMessage, setBuildMessage] = useState('')
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null)
  const [selectedRelations, setSelectedRelations] = useState<KGEdge[]>([])
  const [relatedNodes, setRelatedNodes] = useState<KGNode[]>([])
  const [communityFilter, setCommunityFilter] = useState<string>('')
  const [rightTab, setRightTab] = useState<'insights' | 'risks' | 'domains' | 'profiles'>('insights')
  const [domainTab, setDomainTab] = useState<string>('all')
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [linkedAssets, setLinkedAssets] = useState<LinkedAsset[]>([])
  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [, setHoveredNodeId] = useState<number | null>(null)

  const [personProfiles, setPersonProfiles] = useState<{ id: number; name: string; mention_count: number }[]>([])
  const [personProfilesLoading, setPersonProfilesLoading] = useState(false)
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null)
  const [selectedProfileData, setSelectedProfileData] = useState<ProfileData | null>(null)
  const [selectedProfileLoading, setSelectedProfileLoading] = useState(false)
  const [generatingProfile, setGeneratingProfile] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [assetDetail, setAssetDetail] = useState<DocumentDetail | null>(null)
  const [meetingDetail, setMeetingDetail] = useState<MeetingDetailData | null>(null)
  const [assetModalType, setAssetModalType] = useState<'document' | 'communication'>('document')
  const [assetLoading, setAssetLoading] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // KG Profile 向导相关
  const [showWizard, setShowWizard] = useState(false)
  const [kgProfile, setKgProfile] = useState<Record<string, unknown> | null>(null)
  const [kgProfileLoaded, setKgProfileLoaded] = useState(false)

  const [activeInsightKey, setActiveInsightKey] = useState<string | null>(null)
  const activeHighlightRef = useRef<{ key: string; ids: Set<number> } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const topIdsRef = useRef<Set<number>>(new Set())

  // ── 获取图谱数据 ──
  // ── 加载 KG Profile ──
  useEffect(() => {
    api.get('/knowledge-graph/profile')
      .then(res => { setKgProfile(res.data); setKgProfileLoaded(true) })
      .catch(() => setKgProfileLoaded(true))
  }, [])

  const fetchGraph = useCallback(() => {
    setLoading(true)
    const params: Record<string, unknown> = { limit: 150 }
    // 业务域Tab映射到community_id
    if (domainTab !== 'all') {
      params.community_id = parseInt(domainTab)
    } else if (communityFilter) {
      params.community_id = parseInt(communityFilter)
    }

    const graphPromise = api.get('/knowledge-graph', { params })
    const statsPromise = api.get('/knowledge-graph/stats')
    const insightsPromise = api.get('/knowledge-graph/insights').catch(() => ({ data: [] }))
    const risksPromise = api.get('/knowledge-graph/risks').catch(() => ({ data: [] }))

    Promise.all([graphPromise, statsPromise, insightsPromise, risksPromise])
      .then(([graphRes, statsRes, insightsRes, risksRes]) => {
        // 过滤掉没有业务域归属的节点（community_id 为 null）
        const rawNodes: KGNode[] = graphRes.data.nodes || []
        const domainNodes = rawNodes.filter(n => n.community_id !== null)
        setNodes(domainNodes)
        // 过滤掉引用了被移除节点的边
        const domainNodeIds = new Set(domainNodes.map(n => n.id))
        const rawEdges: KGEdge[] = graphRes.data.edges || []
        setEdges(rawEdges.filter(e => domainNodeIds.has(e.source_entity_id) && domainNodeIds.has(e.target_entity_id)))
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
  }, [communityFilter, domainTab])

  useEffect(() => { fetchGraph() }, [fetchGraph])

  // ── 轮询构建进度（抽取为独立函数，页面加载和手动触发均可复用） ──
  const kgTaskId = 'kg-build'
  const pollBuildProgress = useCallback(async () => {
    setBuilding(true)
    addTask(kgTaskId, '知识图谱生成', '/chat?tab=graph')
    updateTask(kgTaskId, { message: '正在构建...' })
    try {
      let done = false
      while (!done) {
        const res = await api.get('/knowledge-graph/build-status')
        const { status, progress, message } = res.data
        setBuildProgress(progress || 0)
        setBuildMessage(message || '')
        updateTask(kgTaskId, { progress: progress || 0, message: message || '构建中...' })

        if (status === 'done') {
          if (res.data.result?.analysis) {
            setAnalysisResult(res.data.result.analysis)
          }
          setLastAnalysisAt(new Date().toISOString())
          fetchGraph()
          toast.success('知识图谱生成完成')
          updateTask(kgTaskId, { status: 'done', progress: 100, message: '已完成' })
          done = true
        } else if (status === 'error') {
          toast.error(`知识图谱生成失败: ${message}`)
          updateTask(kgTaskId, { status: 'error', progress: 100, message: message || '失败' })
          done = true
        } else if (status === 'cancelled') {
          toast('知识图谱构建已取消', { icon: '🛑' })
          updateTask(kgTaskId, { status: 'error', message: '已取消' })
          done = true
        } else if (status !== 'running') {
          // idle or unknown — stop polling
          done = true
        } else {
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '未知错误'
      toast.error(`查询构建进度失败: ${detail}`)
      updateTask(kgTaskId, { status: 'error', progress: 100, message: '查询失败' })
    } finally {
      setBuilding(false)
      setBuildProgress(0)
      setBuildMessage('')
    }
  }, [fetchGraph, addTask, updateTask])

  // ── 页面加载时检查是否有正在运行的构建任务 ──
  useEffect(() => {
    let cancelled = false
    api.get('/knowledge-graph/build-status').then(res => {
      if (!cancelled && res.data.status === 'running') {
        pollBuildProgress()
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [pollBuildProgress])

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

    // 构建模拟数据（过滤掉没有业务域归属的实体）
    const simNodes: SimNode[] = nodes
      .filter(n => n.community_id !== null)
      .map(n => ({
        id: n.id,
        name: n.name,
        entity_type: n.entity_type,
        mention_count: n.mention_count,
        community_id: n.community_id,
        importance_score: n.importance_score ?? 0,
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
    const commRadius = Math.min(width, height) * 0.3

    // 力模型
    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(70).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-100))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>().radius(d => getNodeRadius(d) + 5))
      .force('communityX', d3.forceX<SimNode>(d =>
        d.community_id !== null ? width / 2 + commRadius * Math.cos(commAngle(d.community_id)) : width / 2
      ).strength(d => d.community_id !== null ? 0.25 : 0))
      .force('communityY', d3.forceY<SimNode>(d =>
        d.community_id !== null ? height / 2 + commRadius * Math.sin(commAngle(d.community_id)) : height / 2
      ).strength(d => d.community_id !== null ? 0.25 : 0))

    simulationRef.current = simulation

    // 域背景层（在边层之前）
    const domainBgGroup = container.append('g').attr('class', 'domain-backgrounds')

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

    // person 节点用圆形，item 节点用圆角矩形
    node.each(function (d) {
      const el = d3.select(this)
      const r = getNodeRadius(d)
      if (d.entity_type === 'item') {
        const size = r * 1.6
        el.append('rect')
          .attr('width', size).attr('height', size)
          .attr('x', -size / 2).attr('y', -size / 2)
          .attr('rx', 4).attr('ry', 4)
          .attr('fill', getNodeColor(d))
          .attr('stroke', 'white')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.85)
      } else {
        el.append('circle')
          .attr('r', r)
          .attr('fill', getNodeColor(d))
          .attr('stroke', 'white')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.85)
      }
    })

    // 按重要性排序，只有 Top 15 显示标签，其余悬停时显示
    const sortedByImportance = [...simNodes].sort((a, b) => b.importance_score - a.importance_score)
    const topIds = new Set(sortedByImportance.slice(0, 15).map(n => n.id))
    topIdsRef.current = topIds

    node.append('text')
      .text(d => d.name.length > 8 ? d.name.slice(0, 8) + '...' : d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', d => getNodeRadius(d) + 14)
      .attr('font-size', '10px')
      .attr('fill', '#64748b')
      .attr('pointer-events', 'none')
      .attr('user-select', 'none')
      .attr('opacity', d => topIds.has(d.id) ? 1 : 0)

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
      node.select('circle, rect')
        .attr('opacity', (n: SimNode) => n.id === d.id || connected.has(n.id) ? 1 : 0.15)
      // 悬停时显示相关节点标签
      node.select('text')
        .attr('opacity', (n: SimNode) => n.id === d.id || connected.has(n.id) ? 1 : 0)
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
      const active = activeHighlightRef.current
      if (active) {
        // 恢复到洞察/风险高亮状态
        const idSet = active.ids
        node.select('circle, rect')
          .attr('opacity', (n: SimNode) => idSet.has(n.id) ? 1 : 0.15)
          .attr('stroke', (n: SimNode) => idSet.has(n.id) ? '#1e1b4b' : 'white')
          .attr('stroke-width', (n: SimNode) => idSet.has(n.id) ? 3 : 1.5)
        node.select('text')
          .attr('opacity', (n: SimNode) => idSet.has(n.id) ? 1 : 0.1)
        link
          .attr('stroke-opacity', (l: SimLink) => {
            const sid = (l.source as SimNode).id
            const tid = (l.target as SimNode).id
            return idSet.has(sid) && idSet.has(tid) ? 0.8 : 0.08
          })
          .attr('stroke', '#cbd5e1')
      } else {
        node.select('circle, rect').attr('opacity', 0.85)
        // 恢复：只有 Top 节点显示标签
        node.select('text').attr('opacity', (n: SimNode) => topIds.has(n.id) ? 1 : 0)
        link.attr('stroke-opacity', 0.5).attr('stroke', '#cbd5e1')
      }
    })

    // tick 更新位置
    let tickCount = 0
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x ?? 0)
        .attr('y1', d => (d.source as SimNode).y ?? 0)
        .attr('x2', d => (d.target as SimNode).x ?? 0)
        .attr('y2', d => (d.target as SimNode).y ?? 0)

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)

      // 每 10 个 tick 更新域背景圆
      tickCount++
      if (tickCount % 10 === 0) {
        const communityPositions = new Map<number, { xs: number[], ys: number[] }>()
        simNodes.forEach(n => {
          if (n.community_id !== null && n.x !== undefined && n.y !== undefined) {
            if (!communityPositions.has(n.community_id)) {
              communityPositions.set(n.community_id, { xs: [], ys: [] })
            }
            const cp = communityPositions.get(n.community_id)!
            cp.xs.push(n.x)
            cp.ys.push(n.y)
          }
        })

        // 查找社群的 domain_label
        const communityLabelMap = new Map<number, string>()
        for (const c of (analysisResult?.communities ?? [])) {
          communityLabelMap.set(c.community_id, c.domain_label || `业务域${c.community_id + 1}`)
        }

        const bgData = Array.from(communityPositions.entries())
          .filter(([, pos]) => pos.xs.length >= 2)
          .map(([cid, pos]) => {
            const cx = pos.xs.reduce((a, b) => a + b, 0) / pos.xs.length
            const cy = pos.ys.reduce((a, b) => a + b, 0) / pos.ys.length
            const maxDist = Math.max(40, ...pos.xs.map((x, i) =>
              Math.sqrt((x - cx) ** 2 + (pos.ys[i] - cy) ** 2)
            ))
            return { cid, cx, cy, r: maxDist + 30, label: communityLabelMap.get(cid) || '' }
          })

        // 背景圆
        domainBgGroup.selectAll<SVGCircleElement, typeof bgData[0]>('circle')
          .data(bgData, d => String(d.cid))
          .join('circle')
          .attr('cx', d => d.cx)
          .attr('cy', d => d.cy)
          .attr('r', d => d.r)
          .attr('fill', d => COMMUNITY_COLORS[d.cid % COMMUNITY_COLORS.length])
          .attr('opacity', 0.08)
          .attr('stroke', d => COMMUNITY_COLORS[d.cid % COMMUNITY_COLORS.length])
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6 3')

        // 域名标签
        domainBgGroup.selectAll<SVGTextElement, typeof bgData[0]>('text')
          .data(bgData, d => String(d.cid))
          .join('text')
          .attr('x', d => d.cx)
          .attr('y', d => d.cy - d.r + 16)
          .attr('text-anchor', 'middle')
          .attr('font-size', '11px')
          .attr('font-weight', '500')
          .attr('fill', d => COMMUNITY_COLORS[d.cid % COMMUNITY_COLORS.length])
          .attr('opacity', 0.6)
          .attr('pointer-events', 'none')
          .text(d => d.label.length > 6 ? d.label.slice(0, 6) + '…' : d.label)
      }
    })

    return () => {
      simulation.stop()
    }
  }, [nodes, edges, analysisResult])

  // ── 人物画像列表加载 ──

  const loadPersonProfiles = useCallback(async () => {
    setPersonProfilesLoading(true)
    try {
      const res = await api.get('/knowledge-graph/entities', {
        params: { entity_type: 'person', page_size: 100 },
      })
      setPersonProfiles(
        (res.data || []).map((e: KGNode) => ({
          id: e.id,
          name: e.name,
          mention_count: e.mention_count,
        }))
      )
    } catch {
      setPersonProfiles([])
    }
    setPersonProfilesLoading(false)
  }, [])

  const loadPersonProfileDetail = useCallback(async (name: string) => {
    setSelectedProfileName(name)
    setSelectedProfileLoading(true)
    try {
      const res = await api.get('/profile/by-name', { params: { name } })
      setSelectedProfileData(res.data)
    } catch {
      setSelectedProfileData(null)
    }
    setSelectedProfileLoading(false)
  }, [])

  // 切换到 profiles tab 时自动加载列表
  useEffect(() => {
    if (rightTab === 'profiles' && personProfiles.length === 0) {
      loadPersonProfiles()
    }
  }, [rightTab, personProfiles.length, loadPersonProfiles])

  // ── 事件处理 ──

  const handleBuildAndAnalyze = async () => {
    // 首次生成且没有 profile 时，弹出向导
    if (!kgProfile && kgProfileLoaded) {
      setShowWizard(true)
      return
    }
    await startBuild()
  }

  const startBuild = async () => {
    setBuildProgress(0)
    setBuildMessage('正在启动构建任务...')
    try {
      const startRes = await api.post('/knowledge-graph/build-and-analyze')
      if (startRes.data.status === 'running') {
        toast('构建任务已在运行中', { icon: 'ℹ️' })
      }
      await pollBuildProgress()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '未知错误'
      toast.error(`知识图谱生成失败: ${detail}`)
      setBuilding(false)
      setBuildProgress(0)
      setBuildMessage('')
    }
  }

  const handleWizardSubmit = async (data: { user_name: string; user_role: string; user_department: string; user_description: string; focus_people: string[]; focus_projects: string[]; data_sources: string[]; time_range_days: number }) => {
    try {
      await api.post('/knowledge-graph/profile', data)
      setKgProfile(data)
      setShowWizard(false)
      toast.success('配置已保存')
      await startBuild()
    } catch {
      toast.error('保存配置失败')
    }
  }

  const handleOpenAsset = async (asset: LinkedAsset) => {
    setShowAssetModal(true)
    setAssetLoading(true)
    setAssetDetail(null)
    setMeetingDetail(null)
    setAssetModalType(asset.asset_type)
    try {
      if (asset.asset_type === 'communication') {
        const res = await api.get(`/communications/${asset.id}`)
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
      setSelectedRelations(res.data.relations || [])
      setRelatedNodes(res.data.related_entities || [])
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

  // 高亮某些实体（从洞察/风险卡片点击，切换逻辑）
  const highlightEntities = (entityIds: number[], key: string) => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    const topIds = topIdsRef.current

    // 再次点击同一项 → 取消高亮
    if (activeInsightKey === key) {
      setActiveInsightKey(null)
      activeHighlightRef.current = null
      svg.selectAll('.nodes g circle')
        .attr('opacity', 0.85)
        .attr('stroke', 'white')
        .attr('stroke-width', 1.5)
      svg.selectAll('.nodes g text')
        .attr('opacity', (d: any) => topIds.has(d.id) ? 1 : 0)
      svg.selectAll('.links line')
        .attr('stroke-opacity', 0.5)
        .attr('stroke', '#cbd5e1')
      return
    }

    // 点击新的项 → 切换高亮
    setActiveInsightKey(key)
    const idSet = new Set(entityIds)
    activeHighlightRef.current = { key, ids: idSet }
    svg.selectAll('.nodes g circle')
      .attr('opacity', (d: any) => idSet.has(d.id) ? 1 : 0.15)
      .attr('stroke', (d: any) => idSet.has(d.id) ? '#1e1b4b' : 'white')
      .attr('stroke-width', (d: any) => idSet.has(d.id) ? 3 : 1.5)
    svg.selectAll('.nodes g text')
      .attr('opacity', (d: any) => idSet.has(d.id) ? 1 : 0.1)
    svg.selectAll('.links line')
      .attr('stroke-opacity', (d: any) => {
        const sid = (d.source as any).id ?? d.source_entity_id
        const tid = (d.target as any).id ?? d.target_entity_id
        return idSet.has(sid) && idSet.has(tid) ? 0.8 : 0.08
      })
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

  // 获取社群选项：过滤掉成员数 < 2 的小社群
  const allCommunities = analysisResult?.communities ?? []
  const communityOptions = allCommunities.filter(c => c.member_count >= 2)

  // ── 节点颜色（始终按实体类型着色） ──
  function getNodeColor(d: SimNode | KGNode): string {
    return ENTITY_COLORS[d.entity_type] || '#94a3b8'
  }

  function getNodeRadius(d: SimNode | KGNode): number {
    const score = ('importance_score' in d) ? (d as any).importance_score : 0
    // 基于重要性评分：score 0~1 映射到半径 6~28
    return Math.max(6, Math.min(28, 6 + score * 22))
  }

  return (
    <div className="space-y-3">
      {/* ── 顶部工具栏：紧凑单行 ── */}
      <div className="bg-white rounded-xl shadow-sm px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {!embedded && <h1 className="text-lg font-bold text-gray-800 mr-2">数据图谱</h1>}

        {/* 业务域彩色切片 */}
        {communityOptions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => { setDomainTab('all'); setCommunityFilter('') }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                domainTab === 'all'
                  ? 'bg-gray-800 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              全部
            </button>
            {communityOptions.map(c => {
              const domainColor = COMMUNITY_COLORS[c.community_id % COMMUNITY_COLORS.length]
              const label = c.domain_label || `业务域${c.community_id + 1}`
              const displayLabel = label.length > 8 ? label.slice(0, 8) + '…' : label
              const isActive = domainTab === String(c.community_id)
              return (
                <button
                  key={c.community_id}
                  type="button"
                  onClick={() => {
                    const val = String(c.community_id)
                    setDomainTab(val)
                    setCommunityFilter(val)
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                    isActive ? 'text-white shadow-sm' : 'text-gray-600 hover:opacity-80'
                  }`}
                  style={isActive
                    ? { backgroundColor: domainColor }
                    : { backgroundColor: domainColor + '18', color: domainColor }
                  }
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: isActive ? 'white' : domainColor }}
                  />
                  {displayLabel}
                  <span className={`text-[10px] ${isActive ? 'text-white/80' : 'opacity-60'}`}>
                    {c.member_count}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* 右侧：统计 + 时间 + 操作 */}
        <div className="flex items-center gap-2 ml-auto">
          {stats && (
            <span className="text-xs text-gray-400">
              {nodes.length}/{stats.total_entities} 实体 · {edges.length} 关系
            </span>
          )}
          {lastAnalysisAt && (
            <span className="text-xs text-gray-400">
              更新于 {(() => {
                const d = new Date(lastAnalysisAt)
                const now = new Date()
                const diffMs = now.getTime() - d.getTime()
                const diffMin = Math.floor(diffMs / 60000)
                if (diffMin < 1) return '刚刚'
                if (diffMin < 60) return `${diffMin}分钟前`
                const diffHr = Math.floor(diffMin / 60)
                if (diffHr < 24) return `${diffHr}小时前`
                return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              })()}
            </span>
          )}
          <div className="flex items-center gap-2">
            {building && (
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                    style={{ width: `${buildProgress}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">{buildMessage || `${buildProgress}%`}</span>
              </div>
            )}
            {kgProfile && (
              <button
                type="button"
                onClick={() => setShowWizard(true)}
                title="图谱配置"
                className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Settings size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={handleBuildAndAnalyze}
              disabled={building}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {building ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {building ? '生成中...' : '重新生成'}
            </button>
          </div>
        </div>
      </div>

      {/* ── 主体区域：图谱（含浮动节点详情） + 右侧洞察/风险 ── */}
      <div className="flex gap-3" style={{ height: embedded ? '600px' : 'calc(100vh - 180px)', minHeight: '500px' }}>

        {/* 图谱区域（含浮动面板） */}
        <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden relative">

          {/* 浮动图例 */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-3 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm border border-gray-100">
            {Object.entries(ENTITY_LABELS).map(([type, label]) => (
              <div key={type} className="flex items-center gap-1 text-xs text-gray-500">
                <span className={`w-2 h-2 flex-shrink-0 ${type === 'item' ? 'rounded-sm' : 'rounded-full'}`} style={{ backgroundColor: ENTITY_COLORS[type] }} />
                {label}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
            </div>
          ) : nodes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                <Info size={28} className="text-gray-300" />
              </div>
              <p className="text-sm">暂无图谱数据</p>
              <button
                onClick={handleBuildAndAnalyze}
                disabled={building}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
              >
                生成知识图谱
              </button>
            </div>
          ) : (
            <svg ref={svgRef} className="w-full h-full" />
          )}

          {/* 缩放控制 */}
          {nodes.length > 0 && (
            <div className="absolute bottom-3 right-3 flex flex-col gap-1">
              <button onClick={handleZoomIn} className="p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors" title="放大">
                <ZoomIn size={15} className="text-gray-600" />
              </button>
              <button onClick={handleZoomOut} className="p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors" title="缩小">
                <ZoomOut size={15} className="text-gray-600" />
              </button>
              <button onClick={handleResetZoom} className="p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors" title="重置视图">
                <Maximize2 size={15} className="text-gray-600" />
              </button>
            </div>
          )}

          {/* ── 浮动节点详情面板 ── */}
          {selectedNode && (
            <div className="absolute top-3 right-14 bottom-3 w-72 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-gray-200 flex flex-col overflow-hidden z-20">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">节点详情</h3>
                <button onClick={() => setSelectedNode(null)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={14} className="text-gray-400" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
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
                      {communityOptions.find(c => c.community_id === selectedNode.community_id)?.domain_label
                        || communityOptions.find(c => c.community_id === selectedNode.community_id)?.label
                        || `社群 ${selectedNode.community_id}`}
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
                {linkedAssets.filter(a => a.asset_type !== 'communication').length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">关联资产</p>
                    <div className="space-y-1">
                      {linkedAssets.filter(a => a.asset_type !== 'communication').map(asset => (
                        <div
                          key={`${asset.asset_type}-${asset.id}`}
                          onClick={() => handleOpenAsset(asset)}
                          className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded px-2 py-1.5 transition-colors cursor-pointer"
                        >
                          <FileText size={14} className="shrink-0" />
                          <span className="truncate">{asset.title}</span>
                          <span className="text-xs text-gray-400 ml-auto shrink-0">
                            {asset.asset_type === 'communication' ? '沟通记录' : (SOURCE_TYPE_LABELS[asset.source_type] || asset.source_type)}
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
                        {profileData.items.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">关联事项</p>
                            <div className="flex flex-wrap gap-1">
                              {profileData.items.slice(0, 8).map(item => (
                                <span key={item.id} className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs">{item.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {profileData.leadership_insight && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">工作风格</p>
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
            </div>
          </div>
          )}
        </div>

        {/* ── 右侧面板 — 洞察/风险 ── */}
        <div className="w-80 bg-white rounded-xl shadow-sm flex flex-col overflow-hidden shrink-0">
          {/* Tab 切换 */}
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => setRightTab('insights')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${rightTab === 'insights' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <div className="flex items-center justify-center gap-1.5">
                <Lightbulb size={14} />
                洞察
                {analysisResult && analysisResult.insights.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-semibold">{analysisResult.insights.length}</span>
                )}
              </div>
              {rightTab === 'insights' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />}
            </button>
            <button
              onClick={() => setRightTab('risks')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${rightTab === 'risks' ? 'text-red-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <div className="flex items-center justify-center gap-1.5">
                <AlertTriangle size={14} />
                风险
                {analysisResult && analysisResult.risks.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-semibold">{analysisResult.risks.length}</span>
                )}
              </div>
              {rightTab === 'risks' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-red-500 rounded-full" />}
            </button>
            <button
              onClick={() => setRightTab('domains')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${rightTab === 'domains' ? 'text-purple-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <div className="flex items-center justify-center gap-1.5">
                <Network size={14} />
                域
                {communityOptions.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-semibold">{communityOptions.length}</span>
                )}
              </div>
              {rightTab === 'domains' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-purple-500 rounded-full" />}
            </button>
            <button
              onClick={() => setRightTab('profiles')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${rightTab === 'profiles' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <div className="flex items-center justify-center gap-1.5">
                <UserSearch size={14} />
                画像
              </div>
              {rightTab === 'profiles' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />}
            </button>
          </div>

          {/* Tab 内容 */}
          <div className="flex-1 overflow-y-auto p-3">
            {/* 洞察 Tab */}
            {rightTab === 'insights' && (
              analysisResult && analysisResult.insights.length > 0 ? (
                <div className="space-y-2.5">
                  {analysisResult.insights.map((item, idx) => {
                    const insightKey = `insight-${idx}`
                    const isActive = activeInsightKey === insightKey
                    return (
                      <div
                        key={idx}
                        className={`border rounded-lg p-3 cursor-pointer hover:shadow-md transition-all group ${
                          isActive
                            ? 'bg-indigo-100 border-indigo-400 shadow-md ring-2 ring-indigo-300'
                            : 'bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-100 hover:border-indigo-200'
                        }`}
                        onClick={() => item.related_entity_ids.length > 0 && highlightEntities(item.related_entity_ids, insightKey)}
                      >
                        <p className={`text-sm font-medium transition-colors ${isActive ? 'text-indigo-700' : 'text-gray-800 group-hover:text-indigo-700'}`}>{item.title}</p>
                        <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{item.description}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${SEVERITY_CONFIG[item.severity]?.text || 'text-gray-500'} ${SEVERITY_CONFIG[item.severity]?.bg || 'bg-gray-50'} ${SEVERITY_CONFIG[item.severity]?.border || 'border-gray-200'} border`}>
                            {item.severity === 'high' ? '重要' : item.severity === 'medium' ? '一般' : '参考'}
                          </span>
                          {item.related_entity_ids.length > 0 && (
                            <span className="text-[10px] text-indigo-400">{isActive ? '点击取消' : '点击定位 →'}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-12">
                  <Lightbulb size={24} className="text-gray-300" />
                  <p className="text-xs text-center">点击「重新生成」<br />生成业务洞察</p>
                </div>
              )
            )}

            {/* 风险 Tab — 按分类分组 */}
            {rightTab === 'risks' && (
              analysisResult && analysisResult.risks.length > 0 ? (
                <div className="space-y-3">
                  {/* 风险统计摘要 */}
                  <div className="flex gap-1.5">
                    {(['high', 'medium', 'low'] as const).map(sev => {
                      const count = analysisResult.risks.filter(r => r.severity === sev).length
                      if (count === 0) return null
                      const cfg = SEVERITY_CONFIG[sev]
                      return (
                        <span key={sev} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                          {sev === 'high' ? '高危' : sev === 'medium' ? '中等' : '低危'} {count}
                        </span>
                      )
                    })}
                  </div>

                  {/* 按分类分组展示 */}
                  {Object.entries(
                    analysisResult.risks.reduce<Record<string, InsightItem[]>>((acc, r) => {
                      const cat = r.category || 'other'
                      ;(acc[cat] = acc[cat] || []).push(r)
                      return acc
                    }, {})
                  ).map(([category, risks]) => {
                    const catCfg = RISK_CATEGORY_CONFIG[category]
                    return (
                      <div key={category}>
                        <p className={`text-xs font-semibold mb-1.5 flex items-center gap-1 ${catCfg?.color || 'text-gray-600'}`}>
                          <span>{catCfg?.icon || '⚠️'}</span>
                          {catCfg?.label || '其他风险'}
                        </p>
                        <div className="space-y-2">
                          {risks.map((item, idx) => {
                            const sevCfg = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.medium
                            const riskKey = `risk-${category}-${idx}`
                            const isActive = activeInsightKey === riskKey
                            return (
                              <div
                                key={idx}
                                className={`border rounded-lg p-2.5 cursor-pointer hover:shadow-md transition-all group ${
                                  isActive
                                    ? `${sevCfg.bg} ${sevCfg.border} ring-2 ring-offset-1 shadow-md ${item.severity === 'high' ? 'ring-red-300' : item.severity === 'medium' ? 'ring-orange-300' : 'ring-blue-300'}`
                                    : `${sevCfg.bg} ${sevCfg.border}`
                                }`}
                                onClick={() => item.related_entity_ids.length > 0 && highlightEntities(item.related_entity_ids, riskKey)}
                              >
                                <div className="flex items-start gap-2">
                                  <AlertTriangle size={13} className={`${sevCfg.text} mt-0.5 shrink-0`} />
                                  <div className="min-w-0 flex-1">
                                    <p className={`text-sm font-medium ${sevCfg.text} leading-snug`}>{item.title}</p>
                                    <p className={`text-xs mt-1 opacity-75 ${sevCfg.text} leading-relaxed`}>{item.description}</p>
                                    {item.evidence && (
                                      <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                                        <span className="font-medium">证据:</span> {item.evidence}
                                      </p>
                                    )}
                                    {item.suggested_action && (
                                      <p className="text-[11px] text-indigo-600 mt-1 font-medium leading-relaxed">
                                        → {item.suggested_action}
                                      </p>
                                    )}
                                    {item.related_entity_ids.length > 0 && (
                                      <p className="text-[10px] mt-1.5 text-gray-400">{isActive ? '点击取消定位' : '点击定位 →'}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-12">
                  <AlertTriangle size={24} className="text-gray-300" />
                  <p className="text-xs text-center">点击「重新生成」<br />检测业务风险</p>
                </div>
              )
            )}

            {/* 域 Tab — 社群列表 */}
            {rightTab === 'domains' && (
              communityOptions.length > 0 ? (
                <div className="space-y-2">
                  {communityOptions.map((c) => {
                    const domainColor = COMMUNITY_COLORS[c.community_id % COMMUNITY_COLORS.length]
                    const label = c.domain_label || `业务域${c.community_id + 1}`
                    const isActive = domainTab === String(c.community_id)
                    return (
                      <button
                        type="button"
                        key={c.community_id}
                        onClick={() => {
                          setDomainTab(String(c.community_id))
                          setCommunityFilter(String(c.community_id))
                        }}
                        className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-md ${isActive ? 'border-indigo-300 bg-indigo-50/50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: domainColor }} />
                          <span className="text-sm font-medium text-gray-800 truncate">{label}</span>
                          <span className="ml-auto text-[10px] text-gray-400 shrink-0">{c.member_count} 实体</span>
                        </div>
                        {c.top_entities.length > 0 && (
                          <div className="flex flex-wrap gap-1 ml-4">
                            {c.top_entities.slice(0, 5).map((name) => {
                              const nodeInfo = nodes.find(n => n.name === name)
                              const isItem = nodeInfo?.entity_type === 'item'
                              return (
                                <span key={name} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">
                                  <span className={`w-1.5 h-1.5 shrink-0 ${isItem ? 'rounded-sm' : 'rounded-full'}`} style={{ backgroundColor: isItem ? '#f59e0b' : '#6366f1' }} />
                                  {name}
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </button>
                    )
                  })}
                  {domainTab !== 'all' && (
                    <button
                      type="button"
                      onClick={() => { setDomainTab('all'); setCommunityFilter('') }}
                      className="w-full py-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      显示全部域
                    </button>
                  )}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-12">
                  <Network size={24} className="text-gray-300" />
                  <p className="text-xs text-center">点击「重新生成」<br />发现业务域</p>
                </div>
              )
            )}

            {/* 人物画像 Tab */}
            {rightTab === 'profiles' && (
              personProfilesLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
                </div>
              ) : selectedProfileName && selectedProfileData ? (
                /* 画像详情 */
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => { setSelectedProfileName(null); setSelectedProfileData(null) }}
                    className="text-xs text-indigo-600 hover:text-indigo-800 mb-1"
                  >
                    ← 返回列表
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                      <span className="text-indigo-700 font-semibold">{selectedProfileData.name[0]}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{selectedProfileData.name}</p>
                      <p className="text-xs text-gray-400">被提及 {selectedProfileData.mention_count} 次</p>
                    </div>
                  </div>

                  {/* 合作者 */}
                  {selectedProfileData.collaborators.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">合作者</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedProfileData.collaborators.slice(0, 8).map((c) => (
                          <span
                            key={c.id}
                            onClick={() => loadPersonProfileDetail(c.name)}
                            className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 cursor-pointer hover:bg-indigo-100 transition-colors"
                          >
                            {c.name}
                          </span>
                        ))}
                        {selectedProfileData.collaborators.length > 8 && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                            +{selectedProfileData.collaborators.length - 8}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 领导力洞察 */}
                  {selectedProfileData.leadership_insight?.report_markdown ? (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">人物画像分析</p>
                      {/* 六维雷达图 */}
                      {selectedProfileData.leadership_insight.dimensions && Object.keys(selectedProfileData.leadership_insight.dimensions).length > 0 && (
                        <ProfileRadarChart dimensions={selectedProfileData.leadership_insight.dimensions as Record<string, number>} />
                      )}
                      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                        {selectedProfileData.leadership_insight.report_markdown}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 text-center py-2">暂无人物画像分析数据</p>
                  )}
                </div>
              ) : selectedProfileLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
                </div>
              ) : personProfiles.length > 0 ? (
                /* 人物列表 */
                <div className="space-y-1.5">
                  {personProfiles.map((person) => (
                    <button
                      type="button"
                      key={person.id}
                      onClick={() => loadPersonProfileDetail(person.name)}
                      className="w-full text-left p-2.5 rounded-lg border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/50 transition-all"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                          <span className="text-indigo-700 font-semibold text-xs">{person.name[0]}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{person.name}</p>
                          <p className="text-[10px] text-gray-400">提及 {person.mention_count} 次</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-12">
                  <UserSearch size={24} className="text-gray-300" />
                  <p className="text-xs text-center">暂无人物画像<br />请先构建知识图谱</p>
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
              <h2 className="text-lg font-semibold text-gray-800">{assetModalType === 'communication' ? '沟通详情' : '文档详情'}</h2>
              <button onClick={() => setShowAssetModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
            </div>
            {assetLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
              </div>
            ) : assetModalType === 'communication' && meetingDetail ? (
              /* ── 会议详情 ── */
              <div className="p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-800">{meetingDetail.title || '无标题'}</h3>

                <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                  {meetingDetail.comm_time && (
                    <span>{new Date(meetingDetail.comm_time).toLocaleString('zh-CN')}{meetingDetail.duration_minutes ? ` (${meetingDetail.duration_minutes}分钟)` : ''}</span>
                  )}
                  {meetingDetail.location && <span>{meetingDetail.location}</span>}
                </div>

                {meetingDetail.uploader_name && (
                  <div><p className="text-sm text-indigo-600 font-medium">资产所有人</p><p className="text-sm text-gray-800 font-medium">{meetingDetail.uploader_name}</p></div>
                )}
                {meetingDetail.initiator && (
                  <div><p className="text-sm text-gray-500">组织者/发送者</p><p className="text-sm text-gray-800 font-medium">{meetingDetail.initiator}</p></div>
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
                  <div><p className="text-sm text-indigo-600 font-medium">资产所有人</p><p className="text-sm text-gray-800 font-medium">{assetDetail.uploader_name}</p></div>
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

      {/* KG Profile 向导 */}
      {showWizard && (
        <KGProfileWizard
          defaultValues={kgProfile as any}
          onSubmit={handleWizardSubmit}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  )
}
