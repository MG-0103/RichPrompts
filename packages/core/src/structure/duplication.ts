import { jaccard, trigrams } from '../similarity'
import type { Paragraph } from './types'

export interface DuplicationCluster {
  id: string
  paragraphIds: string[]
  /** Average pairwise similarity within the cluster. */
  similarity: number
  /** Total chars across the cluster's paragraphs. */
  totalChars: number
  /** True if the cluster spans more than one canonical section. */
  crossSection: boolean
  /** First ~80 chars of the shortest cluster member — used as a preview. */
  preview: string
}

export interface DuplicationEdge {
  from: string  // paragraph id
  to: string    // paragraph id
  similarity: number
  clusterId: string
}

export interface DuplicationAnalysis {
  clusters: DuplicationCluster[]
  edges: DuplicationEdge[]
}

export interface DuplicationOptions {
  /** Jaccard threshold above which pairs are considered similar. */
  threshold?: number
  /** Skip paragraphs shorter than this — trivially short paragraphs
   *  produce noise. */
  minChars?: number
  /** Safety cap on paragraph count for pairwise comparison. */
  maxParagraphs?: number
}

/**
 * Cluster near-duplicate paragraphs using trigram Jaccard, plus the
 * pairwise edges that produced those clusters (for graph rendering).
 * O(n²) in paragraph count; capped at maxParagraphs for safety.
 */
export function analyzeDuplication(
  paragraphs: Paragraph[],
  opts: DuplicationOptions = {},
): DuplicationAnalysis {
  const threshold = opts.threshold ?? 0.5
  const minChars = opts.minChars ?? 60
  const maxParagraphs = opts.maxParagraphs ?? 250

  const eligible = paragraphs.filter(p => p.text.trim().length >= minChars)
  if (eligible.length < 2 || eligible.length > maxParagraphs) {
    return { clusters: [], edges: [] }
  }

  // Cache trigram sets per paragraph
  const trigramCache = new Map<string, Set<string>>()
  const grams = (p: Paragraph): Set<string> => {
    let tg = trigramCache.get(p.id)
    if (!tg) {
      tg = trigrams(p.text)
      trigramCache.set(p.id, tg)
    }
    return tg
  }

  // Union-find
  const parent = new Map<string, string>()
  for (const p of eligible) parent.set(p.id, p.id)
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    // Path compression
    let cur = x
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!
      parent.set(cur, r)
      cur = next
    }
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  // Collect pairwise similarities so we can compute per-cluster averages
  const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`
  const pairSims = new Map<string, number>()

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i], b = eligible[j]
      const sim = jaccard(grams(a), grams(b))
      if (sim < threshold) continue
      pairSims.set(pairKey(a.id, b.id), sim)
      union(a.id, b.id)
    }
  }

  // Bucket paragraphs by cluster root
  const groups = new Map<string, string[]>()
  for (const p of eligible) {
    const root = find(p.id)
    let list = groups.get(root)
    if (!list) { list = []; groups.set(root, list) }
    list.push(p.id)
  }

  const byId = new Map(paragraphs.map(p => [p.id, p]))
  const out: DuplicationCluster[] = []
  let clusterId = 0
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    // mean similarity within the cluster
    let sum = 0, count = 0
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        sum += pairSims.get(pairKey(ids[i], ids[j])) ?? 0
        count++
      }
    }
    const similarity = count > 0 ? sum / count : 0
    const members = ids.map(id => byId.get(id)!).filter(Boolean)
    const totalChars = members.reduce((a, p) => a + p.text.length, 0)
    const sections = new Set(members.map(p => p.section ?? 'other'))
    const crossSection = sections.size > 1
    const shortest = members.reduce((a, p) => p.text.length < a.text.length ? p : a, members[0])
    const previewSource = shortest.text.replace(/\s+/g, ' ').trim()
    const preview = previewSource.slice(0, 80) + (previewSource.length > 80 ? '…' : '')
    out.push({
      id: `dup-${clusterId++}`,
      paragraphIds: ids,
      similarity,
      totalChars,
      crossSection,
      preview,
    })
  }

  // Rank: high total × mean-sim first — biggest merge value at the top
  out.sort((a, b) => (b.totalChars * b.similarity) - (a.totalChars * a.similarity))

  // Build edges list — one entry per (root, memberA, memberB) with the
  // recorded similarity. Assign each edge to its cluster id.
  const clusterByRoot = new Map<string, string>()
  for (const c of out) {
    const root = find(c.paragraphIds[0])
    clusterByRoot.set(root, c.id)
  }
  const edges: DuplicationEdge[] = []
  for (const [key, sim] of pairSims) {
    const [a, b] = key.split('|')
    const clusterId = clusterByRoot.get(find(a))
    if (!clusterId) continue
    edges.push({ from: a, to: b, similarity: sim, clusterId })
  }

  return { clusters: out, edges }
}

/** Back-compat: only clusters, no edges. */
export function detectDuplicationClusters(
  paragraphs: Paragraph[],
  opts: DuplicationOptions = {},
): DuplicationCluster[] {
  return analyzeDuplication(paragraphs, opts).clusters
}

/**
 * Templated advice for a cluster, based on its shape.
 */
export function adviceFor(cluster: DuplicationCluster, paragraphs: Paragraph[]): string {
  const byId = new Map(paragraphs.map(p => [p.id, p]))
  const members = cluster.paragraphIds.map(id => byId.get(id)!).filter(Boolean)
  const sections = new Set(members.map(p => p.section ?? 'other'))
  const pct = Math.round(cluster.similarity * 100)
  const size = cluster.paragraphIds.length
  if (cluster.crossSection && sections.size >= 3) {
    return `${size} paragraphs at ~${pct}% similarity spanning ${Array.from(sections).join(', ')} — likely a stray concern that wants its own dedicated section.`
  }
  if (cluster.crossSection) {
    return `Same instruction appears in ${Array.from(sections).join(' and ')} — pick one canonical home.`
  }
  return `${size} paragraphs in ${Array.from(sections)[0]} share ~${pct}% content. Merging saves ~${cluster.totalChars} chars.`
}
