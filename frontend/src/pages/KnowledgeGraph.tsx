import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, RefreshCw, X, Loader2, Info } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface KGNode {
  id: number
  name: string
  entity_type: string
  mention_count: number
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

const ENTITY_COLORS: Record<string, string> = {
  person: '#6366f1',
  project: '#f59e0b',
  topic: '#10b981',
  organization: '#8b5cf6',
  event: '#ef4444',
  document: '#3b82f6',
}

const ENTITY_LABELS: Record<string, string> = {
  person: '人物',
  project: '项目',
  topic: '主题',
  organization: '组织',
  event: '事件',
  document: '文档',
}

const RELATION_LABELS: Record<string, string> = {
  collaborates_with: '合作',
  works_on: '参与',
  discusses: '讨论',
  belongs_to: '隶属',
  related_to: '关联',
}

export default function KnowledgeGraph() {
  const [nodes, setNodes] = useState<KGNode[]>([])
  const [edges, setEdges] = useState<KGEdge[]>([])
  const [stats, setStats] = useState<KGStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null)
  const [selectedRelations, setSelectedRelations] = useState<KGEdge[]>([])
  const [relatedNodes, setRelatedNodes] = useState<KGNode[]>([])
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)
  const [positions, setPositions] = useState<Map<number, { x: number; y: number }>>(new Map())

  const fetchGraph = useCallback(() => {
    setLoading(true)
    const params: Record<string, unknown> = { limit: 200 }
    if (typeFilter) params.entity_type = typeFilter

    Promise.all([
      api.get('/knowledge-graph', { params }),
      api.get('/knowledge-graph/stats'),
    ])
      .then(([graphRes, statsRes]) => {
        setNodes(graphRes.data.nodes)
        setEdges(graphRes.data.edges)
        setStats(statsRes.data)
        layoutNodes(graphRes.data.nodes)
      })
      .catch(() => toast.error('加载图谱失败'))
      .finally(() => setLoading(false))
  }, [typeFilter])

  useEffect(() => {
    fetchGraph()
  }, [fetchGraph])

  const layoutNodes = (nodeList: KGNode[]) => {
    // 力导向布局的简化实现
    const width = 800
    const height = 600
    const map = new Map<number, { x: number; y: number }>()

    nodeList.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / nodeList.length
      const radius = Math.min(width, height) * 0.35
      map.set(node.id, {
        x: width / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 50,
        y: height / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 50,
      })
    })

    // 简单的力导向迭代
    for (let iter = 0; iter < 50; iter++) {
      // 斥力
      for (const a of nodeList) {
        for (const b of nodeList) {
          if (a.id === b.id) continue
          const pa = map.get(a.id)!
          const pb = map.get(b.id)!
          const dx = pa.x - pb.x
          const dy = pa.y - pb.y
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
          const force = 2000 / (dist * dist)
          pa.x += (dx / dist) * force
          pa.y += (dy / dist) * force
        }
      }

      // 引力（边）
      // Use the existing edges from closure since we call this synchronously
    }

    // 归一化到视图范围
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    map.forEach((p) => {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    })

    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const padding = 60

    map.forEach((p) => {
      p.x = padding + ((p.x - minX) / rangeX) * (width - 2 * padding)
      p.y = padding + ((p.y - minY) / rangeY) * (height - 2 * padding)
    })

    setPositions(map)
  }

  const handleBuild = async () => {
    setBuilding(true)
    try {
      const res = await api.post('/knowledge-graph/build', null, {
        params: { incremental: true },
      })
      toast.success(
        `图谱更新完成：新增 ${res.data.entities_added} 实体，${res.data.relations_added} 关系`
      )
      fetchGraph()
    } catch {
      toast.error('图谱构建失败')
    } finally {
      setBuilding(false)
    }
  }

  const handleNodeClick = async (node: KGNode) => {
    setSelectedNode(node)
    try {
      const res = await api.get(`/knowledge-graph/entities/${node.id}`)
      setSelectedRelations(res.data.relations)
      setRelatedNodes(res.data.related_entities)
    } catch {
      setSelectedRelations([])
      setRelatedNodes([])
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
        limit: 50,
      })
      setNodes(res.data)
      layoutNodes(res.data)
    } catch {
      toast.error('搜索失败')
    }
  }

  const getNodeRadius = (node: KGNode) => {
    return Math.max(8, Math.min(30, 8 + node.mention_count * 2))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">知识图谱</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索实体..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-48"
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
          <button
            onClick={handleBuild}
            disabled={building}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
          >
            {building ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {building ? '构建中...' : '构建图谱'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex gap-4 flex-wrap">
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
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: ENTITY_COLORS[type] || '#94a3b8' }}
              />
              <span className="text-gray-500">{ENTITY_LABELS[type] || type}:</span>{' '}
              <span className="font-semibold text-gray-800">{count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        {/* Graph */}
        <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="h-[600px] flex items-center justify-center text-gray-400">加载中...</div>
          ) : nodes.length === 0 ? (
            <div className="h-[600px] flex flex-col items-center justify-center text-gray-400 gap-2">
              <Info size={32} />
              <p>暂无图谱数据，点击"构建图谱"开始</p>
            </div>
          ) : (
            <svg ref={svgRef} viewBox="0 0 800 600" className="w-full h-[600px]">
              {/* Edges */}
              {edges.map((edge) => {
                const sp = positions.get(edge.source_entity_id)
                const tp = positions.get(edge.target_entity_id)
                if (!sp || !tp) return null
                return (
                  <line
                    key={edge.id}
                    x1={sp.x}
                    y1={sp.y}
                    x2={tp.x}
                    y2={tp.y}
                    stroke="#e2e8f0"
                    strokeWidth={Math.max(1, Math.min(4, edge.weight))}
                    opacity={0.6}
                  />
                )
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const pos = positions.get(node.id)
                if (!pos) return null
                const r = getNodeRadius(node)
                const isSelected = selectedNode?.id === node.id
                return (
                  <g
                    key={node.id}
                    className="cursor-pointer"
                    onClick={() => handleNodeClick(node)}
                  >
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={r}
                      fill={ENTITY_COLORS[node.entity_type] || '#94a3b8'}
                      opacity={0.8}
                      stroke={isSelected ? '#1e1b4b' : 'white'}
                      strokeWidth={isSelected ? 3 : 1.5}
                    />
                    <text
                      x={pos.x}
                      y={pos.y + r + 14}
                      textAnchor="middle"
                      className="text-[10px] fill-gray-600 select-none pointer-events-none"
                    >
                      {node.name.length > 8 ? node.name.slice(0, 8) + '...' : node.name}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="w-80 bg-white rounded-xl shadow-sm p-4 space-y-4 h-fit max-h-[600px] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">{selectedNode.name}</h3>
              <button onClick={() => setSelectedNode(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: ENTITY_COLORS[selectedNode.entity_type] }}
              />
              <span className="text-sm text-gray-500">
                {ENTITY_LABELS[selectedNode.entity_type] || selectedNode.entity_type}
              </span>
              <span className="text-sm text-gray-400 ml-auto">
                提及 {selectedNode.mention_count} 次
              </span>
            </div>

            {selectedNode.first_seen_at && (
              <p className="text-xs text-gray-400">
                首次出现: {new Date(selectedNode.first_seen_at).toLocaleDateString('zh-CN')}
              </p>
            )}

            {selectedRelations.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">关联关系</p>
                <div className="space-y-2">
                  {selectedRelations.map((rel) => {
                    const otherNodeId =
                      rel.source_entity_id === selectedNode.id
                        ? rel.target_entity_id
                        : rel.source_entity_id
                    const otherNode = relatedNodes.find((n) => n.id === otherNodeId)
                    const direction =
                      rel.source_entity_id === selectedNode.id ? '→' : '←'
                    return (
                      <div
                        key={rel.id}
                        className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-100"
                        onClick={() => {
                          if (otherNode) handleNodeClick(otherNode)
                        }}
                      >
                        <span className="text-gray-400">{direction}</span>
                        <span className="text-gray-600">
                          {RELATION_LABELS[rel.relation_type] || rel.relation_type}
                        </span>
                        <span className="font-medium text-gray-800">
                          {otherNode?.name || `#${otherNodeId}`}
                        </span>
                        {rel.weight > 1 && (
                          <span className="text-xs text-gray-400 ml-auto">x{rel.weight}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
