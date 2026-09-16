import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CanonicalSection,
  DuplicationCluster,
  DuplicationEdge,
  Paragraph,
} from '@richprompt/core'

const SECTION_COLORS: Record<CanonicalSection, string> = {
  role:        '#4a8fd6',
  task:        '#5ab671',
  output:      '#9a6ad9',
  constraints: '#d69a3a',
}
const OTHER_COLOR = '#666'

interface Props {
  clusters: DuplicationCluster[]
  edges: DuplicationEdge[]
  paragraphs: Paragraph[]
  onJumpTo: (offset: number) => void
}

type SimNode = {
  id: string
  chars: number
  section: CanonicalSection | 'other'
  clusterId: string
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

type SimLink = {
  source: string | SimNode
  target: string | SimNode
  similarity: number
  clusterId: string
}

const WIDTH = 640
const HEIGHT = 320

export function DuplicationGraph({ clusters, edges, paragraphs, onJumpTo }: Props) {
  const [d3, setD3] = useState<typeof import('d3-force') | null>(null)
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const simRef = useRef<import('d3-force').Simulation<SimNode, SimLink> | null>(null)

  // Load d3-force lazily.
  useEffect(() => {
    let cancelled = false
    import('d3-force').then(mod => {
      if (!cancelled) setD3(mod)
    })
    return () => { cancelled = true }
  }, [])

  const paragraphById = useMemo(() => {
    const m = new Map<string, Paragraph>()
    for (const p of paragraphs) m.set(p.id, p)
    return m
  }, [paragraphs])

  // Build node + link arrays from clusters/edges. Only cluster members
  // become nodes — isolated paragraphs are not shown.
  const { simNodes, simLinks } = useMemo(() => {
    const nodeIds = new Set<string>()
    for (const c of clusters) for (const id of c.paragraphIds) nodeIds.add(id)
    const clusterByParagraph = new Map<string, string>()
    for (const c of clusters) for (const id of c.paragraphIds) clusterByParagraph.set(id, c.id)
    const nodes: SimNode[] = Array.from(nodeIds).map(id => {
      const p = paragraphById.get(id)!
      return {
        id,
        chars: p.text.length,
        section: p.section ?? 'other',
        clusterId: clusterByParagraph.get(id) ?? '',
      }
    })
    const links: SimLink[] = edges
      .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map(e => ({ source: e.from, target: e.to, similarity: e.similarity, clusterId: e.clusterId }))
    return { simNodes: nodes, simLinks: links }
  }, [clusters, edges, paragraphById])

  // Run the physics simulation whenever inputs change.
  useEffect(() => {
    if (!d3) return
    if (simNodes.length === 0) { setNodes([]); return }
    const sim = d3
      .forceSimulation<SimNode, SimLink>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id(n => n.id)
        .strength(l => l.similarity * 0.9)
        .distance(l => 30 + (1 - l.similarity) * 90))
      .force('charge', d3.forceManyBody().strength(-90))
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collision', d3.forceCollide<SimNode>().radius(n => radiusFor(n) + 3))
      .alpha(1)
      .alphaDecay(0.05)
      .on('tick', () => {
        setNodes(sim.nodes().map(n => ({ ...n })))
      })
    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [d3, simNodes, simLinks])

  if (simNodes.length === 0) {
    return (
      <div className="dup-graph-empty">
        No duplication clusters — nothing to graph.
      </div>
    )
  }
  if (!d3) {
    return <div className="dup-graph-empty">Loading graph…</div>
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const hoverCluster = hoverId ? nodeById.get(hoverId)?.clusterId : null

  return (
    <div className="dup-graph-wrap">
      <svg
        ref={svgRef}
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="dup-graph"
      >
        {simLinks.map((l, i) => {
          const s = typeof l.source === 'string' ? nodeById.get(l.source) : nodeById.get((l.source as SimNode).id)
          const t = typeof l.target === 'string' ? nodeById.get(l.target) : nodeById.get((l.target as SimNode).id)
          if (!s || !t || s.x == null || t.x == null) return null
          const inHover = hoverCluster !== null && l.clusterId === hoverCluster
          const strength = l.similarity
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={inHover ? '#dc9' : '#4a5568'}
              strokeOpacity={hoverCluster && !inHover ? 0.15 : 0.5 + strength * 0.4}
              strokeWidth={1 + strength * 3}
            />
          )
        })}
        {nodes.map(n => {
          const p = paragraphById.get(n.id)
          if (!p || n.x == null || n.y == null) return null
          const r = radiusFor(n)
          const dimmed = hoverCluster !== null && n.clusterId !== hoverCluster
          const label = p.text.trim().slice(0, 120).replace(/\n+/g, ' ↩ ')
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className="dup-node"
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onJumpTo(p.startOffset)}
            >
              <circle
                r={r}
                fill={n.section === 'other' ? OTHER_COLOR : SECTION_COLORS[n.section]}
                fillOpacity={dimmed ? 0.25 : 0.85}
                stroke={hoverId === n.id ? '#fff' : '#1a1a1a'}
                strokeWidth={hoverId === n.id ? 2 : 1}
              />
              <title>
                {label}
                {'\n'}
                @{p.startOffset} · {p.text.length} chars · {n.section}
              </title>
            </g>
          )
        })}
      </svg>
      <GraphLegend clusters={clusters} />
    </div>
  )
}

function radiusFor(n: SimNode): number {
  const min = 5, max = 18
  // Scale char count with log so a 4000-char paragraph doesn't dominate.
  const log = Math.log10(Math.max(1, n.chars))
  const scaled = min + (log / 3.6) * (max - min)
  return Math.min(max, Math.max(min, scaled))
}

function GraphLegend({ clusters }: { clusters: DuplicationCluster[] }) {
  const totalDup = clusters.reduce((a, c) => a + c.paragraphIds.length, 0)
  return (
    <div className="dup-graph-legend">
      <span>
        {clusters.length} cluster{clusters.length === 1 ? '' : 's'} · {totalDup} paragraph{totalDup === 1 ? '' : 's'}
      </span>
      <span className="legend-swatches">
        {(['role', 'task', 'output', 'constraints'] as CanonicalSection[]).map(c => (
          <span key={c} className="lgs">
            <span className="lgs-dot" style={{ background: SECTION_COLORS[c] }} />
            <span>{c}</span>
          </span>
        ))}
      </span>
    </div>
  )
}
