import { jaccard, trigrams } from '../similarity'
import type { Paragraph } from './types'

const SHARED_MIN_LCS = 25
const SHARED_MAX_NGRAMS = 5
const NGRAM_MIN_WORDS = 3
const NGRAM_MAX_WORDS = 5

/** Normalize whitespace so incidental spacing doesn't split LCS matches. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Longest common substring between two strings via DP. O(n·m) time
 * and O(min(n,m)) space (rolling row). Empty when nothing matches.
 * Whitespace is normalized so a 500-char paragraph pair runs in ~250k
 * ops — under a millisecond.
 */
export function longestCommonSubstring(aRaw: string, bRaw: string): string {
  const a = normalize(aRaw)
  const b = normalize(bRaw)
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return ''
  // Ensure `a` is the shorter — reduces memory for the rolling row.
  const [s, t] = n <= m ? [a, b] : [b, a]
  const sLen = s.length
  const tLen = t.length
  const prev = new Uint32Array(sLen + 1)
  const curr = new Uint32Array(sLen + 1)
  let bestLen = 0
  let bestEndInT = 0
  for (let i = 1; i <= tLen; i++) {
    for (let j = 1; j <= sLen; j++) {
      if (t[i - 1] === s[j - 1]) {
        curr[j] = prev[j - 1] + 1
        if (curr[j] > bestLen) {
          bestLen = curr[j]
          bestEndInT = i
        }
      } else {
        curr[j] = 0
      }
    }
    prev.set(curr)
    curr.fill(0)
  }
  return t.slice(bestEndInT - bestLen, bestEndInT)
}

/**
 * Return the two paragraph ids in a cluster with the highest recorded
 * pairwise similarity. Ties broken by original order.
 */
function topPair(
  ids: string[],
  pairSims: Map<string, number>,
): [string | null, string | null] {
  if (ids.length < 2) return [null, null]
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  let bestA = ids[0], bestB = ids[1]
  let bestSim = pairSims.get(key(bestA, bestB)) ?? -1
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sim = pairSims.get(key(ids[i], ids[j])) ?? -1
      if (sim > bestSim) {
        bestSim = sim
        bestA = ids[i]
        bestB = ids[j]
      }
    }
  }
  return [bestA, bestB]
}

/**
 * Multi-word phrases (3-5 word n-grams) that appear in ≥ 2 of the
 * given texts. Ranked by phrase word-length desc, tie-break on
 * frequency. Returns up to SHARED_MAX_NGRAMS.
 */
export function sharedPhrases(texts: string[]): string[] {
  if (texts.length < 2) return []
  const counts = new Map<string, number>()
  for (const raw of texts) {
    const tokens = normalize(raw.toLowerCase()).split(/\s+/).filter(w => w.length > 0)
    const seenInDoc = new Set<string>()
    for (let n = NGRAM_MIN_WORDS; n <= NGRAM_MAX_WORDS; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n).join(' ')
        if (seenInDoc.has(gram)) continue
        seenInDoc.add(gram)
      }
    }
    for (const gram of seenInDoc) {
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
  }
  const shared = Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => {
      const aWords = a[0].split(' ').length
      const bWords = b[0].split(' ').length
      if (bWords !== aWords) return bWords - aWords
      return b[1] - a[1]
    })
  // Drop n-grams that are wholly contained in a longer kept one.
  const out: string[] = []
  for (const [gram] of shared) {
    if (out.some(kept => kept.includes(gram))) continue
    out.push(gram)
    if (out.length >= SHARED_MAX_NGRAMS) break
  }
  return out
}

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
  /** Longest common substring across the top-similarity pair. Empty
   *  when no substring of ≥ SHARED_MIN_LCS chars is shared (e.g.
   *  paraphrase-shaped clusters). */
  sharedText: string
  /** Shared multi-word phrases (3-5 word n-grams) that appear in
   *  ≥ 2 members. Fallback for paraphrase clusters where sharedText
   *  is empty. Ranked by phrase length. */
  sharedNgrams: string[]
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

    // LCS from the top-similarity pair in the cluster; n-grams across
    // all members as a fallback for paraphrase-shaped clusters.
    const [topA, topB] = topPair(ids, pairSims)
    const lcsRaw = topA && topB
      ? longestCommonSubstring(byId.get(topA)!.text, byId.get(topB)!.text)
      : ''
    const sharedText = lcsRaw.length >= SHARED_MIN_LCS ? lcsRaw : ''
    const sharedNgrams = sharedPhrases(members.map(p => p.text))

    out.push({
      id: `dup-${clusterId++}`,
      paragraphIds: ids,
      similarity,
      totalChars,
      crossSection,
      preview,
      sharedText,
      sharedNgrams,
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
 * Cluster paragraphs using an arbitrary pairwise similarity function.
 * The trigram-based `analyzeDuplication` is the built-in caller; the
 * web app's semantic (embeddings) path plugs cosine similarity in
 * here and gets clusters, edges, LCS, and n-grams for free.
 */
export function clusterByPairwiseSimilarity(
  paragraphs: Paragraph[],
  simFn: (a: Paragraph, b: Paragraph) => number,
  opts: DuplicationOptions = {},
): DuplicationAnalysis {
  const threshold = opts.threshold ?? 0.5
  const minChars = opts.minChars ?? 60
  const maxParagraphs = opts.maxParagraphs ?? 250

  const eligible = paragraphs.filter(p => p.text.trim().length >= minChars)
  if (eligible.length < 2 || eligible.length > maxParagraphs) {
    return { clusters: [], edges: [] }
  }

  const parent = new Map<string, string>()
  for (const p of eligible) parent.set(p.id, p.id)
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
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

  const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`
  const pairSims = new Map<string, number>()

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i], b = eligible[j]
      const sim = simFn(a, b)
      if (sim < threshold) continue
      pairSims.set(pairKey(a.id, b.id), sim)
      union(a.id, b.id)
    }
  }

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

    const [topA, topB] = topPair(ids, pairSims)
    const lcsRaw = topA && topB
      ? longestCommonSubstring(byId.get(topA)!.text, byId.get(topB)!.text)
      : ''
    const sharedText = lcsRaw.length >= SHARED_MIN_LCS ? lcsRaw : ''
    const sharedNgrams = sharedPhrases(members.map(p => p.text))

    out.push({
      id: `dup-${clusterId++}`,
      paragraphIds: ids,
      similarity,
      totalChars,
      crossSection,
      preview,
      sharedText,
      sharedNgrams,
    })
  }

  out.sort((a, b) => (b.totalChars * b.similarity) - (a.totalChars * a.similarity))

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
