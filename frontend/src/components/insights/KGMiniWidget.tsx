import { useEffect, useState, useRef } from 'react'
import { Network, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import * as d3 from 'd3'
import WidgetContainer from './WidgetContainer'
import api from '../../lib/api'

interface KGNode {
  id: number
  name: string
  entity_type: string
  mention_count: number
  community_id: number | null
}

interface KGEdge {
  id: number
  source_entity_id: number
  target_entity_id: number
  relation_type: string
  weight: number
}

interface SimNode extends d3.SimulationNodeDatum {
  id: number
  name: string
  entity_type: string
  mention_count: number
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: number
  weight: number
}

const ENTITY_COLORS: Record<string, string> = {
  person: '#6366f1',
  item: '#f59e0b',
}

export default function KGMiniWidget({
  onSelectPerson,
  onClose,
}: {
  onSelectPerson?: (name: string) => void
  onClose?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef<KGNode[]>([])
  const edgesRef = useRef<KGEdge[]>([])

  const fetch = () => {
    setLoading(true)
    setError(null)
    api.get('/knowledge-graph', { params: { limit: 50 } })
      .then((res) => {
        nodesRef.current = (res.data.nodes || []).slice(0, 50)
        edgesRef.current = res.data.edges || []
      })
      .catch(() => setError('加载图谱数据失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetch() }, [])

  // D3 rendering
  useEffect(() => {
    if (loading || !svgRef.current || nodesRef.current.length === 0) return

    const nodes = nodesRef.current
    const edges = edgesRef.current
    const svg = d3.select(svgRef.current)
    const width = 400
    const height = 300

    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const container = svg.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => container.attr('transform', event.transform))
    svg.call(zoom)

    const simNodes: SimNode[] = nodes.map(n => ({
      id: n.id, name: n.name, entity_type: n.entity_type, mention_count: n.mention_count,
    }))

    const nodeMap = new Map(simNodes.map(n => [n.id, n]))
    const simLinks: SimLink[] = edges
      .filter(e => nodeMap.has(e.source_entity_id) && nodeMap.has(e.target_entity_id))
      .map(e => ({
        id: e.id,
        source: nodeMap.get(e.source_entity_id)!,
        target: nodeMap.get(e.target_entity_id)!,
        weight: e.weight,
      }))

    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(50).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>().radius(d => Math.max(5, 4 + d.mention_count) + 3))

    const link = container.append('g')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.4)

    const node = container.append('g')
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', d => Math.max(5, 4 + d.mention_count))
      .attr('fill', d => ENTITY_COLORS[d.entity_type] || '#94a3b8')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.85)
      .attr('cursor', 'pointer')

    // Labels for top nodes only
    const topNodes = simNodes.filter(n => n.mention_count >= 2).slice(0, 15)
    container.append('g')
      .selectAll('text')
      .data(topNodes)
      .join('text')
      .text(d => d.name.length > 6 ? d.name.slice(0, 6) + '..' : d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', d => Math.max(5, 4 + d.mention_count) + 10)
      .attr('font-size', '8px')
      .attr('fill', '#64748b')
      .attr('pointer-events', 'none')

    node.on('click', (_event, d) => {
      if (d.entity_type === 'person' && onSelectPerson) {
        onSelectPerson(d.name)
      }
    })

    // Drag
    const drag = d3.drag<SVGCircleElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null; d.fy = null
      })
    node.call(drag)

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x ?? 0)
        .attr('y1', d => (d.source as SimNode).y ?? 0)
        .attr('x2', d => (d.target as SimNode).x ?? 0)
        .attr('y2', d => (d.target as SimNode).y ?? 0)
      node
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0)
      container.selectAll<SVGTextElement, SimNode>('text')
        .attr('x', d => d.x ?? 0)
        .attr('y', d => d.y ?? 0)
    })

    return () => { simulation.stop() }
  }, [loading, onSelectPerson])

  return (
    <WidgetContainer
      id="kg-mini"
      title="知识图谱"
      icon={<Network size={20} />}
      loading={loading}
      error={error}
      onRetry={fetch}
      onClose={onClose}
    >
      <div className="relative">
        <svg ref={svgRef} className="w-full" style={{ height: 300 }} />
        <div className="mt-2 flex justify-end">
          <Link
            to="/knowledge-graph"
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
          >
            查看完整图谱 <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </WidgetContainer>
  )
}
