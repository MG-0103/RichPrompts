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
