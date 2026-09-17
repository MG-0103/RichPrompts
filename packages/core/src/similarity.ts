export function trigrams(s: string): Set<string> {
  const normalized = s.toLowerCase().replace(/\s+/g, ' ').trim()
  const padded = `  ${normalized}  `
  const out = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) {
    out.add(padded.slice(i, i + 3))
  }
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const x of a) if (b.has(x)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function similarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b))
}

/**
 * Cosine similarity between two equal-length vectors. Guards against
 * zero-magnitude inputs (returns 0) so downstream clustering doesn't
 * NaN out on stray empty embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
