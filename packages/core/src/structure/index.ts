import { parseDocument } from '../parser'
import type { CanonicalSection, DocType } from '../types'
import { budgetFor, estimateTokens } from './budget'
import { detectDuplicationClusters, type DuplicationOptions } from './duplication'
import { detectExtractionCandidates } from './extract'
import { detectNoise } from './noise'
import { splitParagraphs } from './paragraph'
import type { SectionStats, StructureReport } from './types'

export * from './types'
export { budgetFor, estimateTokens } from './budget'
export { splitParagraphs } from './paragraph'
export { detectNoise } from './noise'
export type { NoiseFlag, NoiseKind } from './noise'
export { detectDuplicationClusters, adviceFor } from './duplication'
export type { DuplicationCluster, DuplicationOptions } from './duplication'
export { detectExtractionCandidates } from './extract'
export type { ExtractionCandidate, ExtractionTarget } from './extract'

export interface AnalyzeOptions {
  model?: string
  duplication?: DuplicationOptions
}

/**
 * R1α: sections + budget only. Duplication, noise, and extraction
 * detectors ship in R1β and later.
 */
export function analyzeStructure(
  raw: string,
  docType: DocType = 'prompt',
  opts: AnalyzeOptions = {},
): StructureReport {
  const doc = parseDocument(raw, docType)
  const paragraphs = splitParagraphs(raw, doc.sections)

  // Aggregate stats per (canonical, heading) key — we want one row per
  // detected section, not one per paragraph.
  const map = new Map<string, SectionStats>()
  for (const p of paragraphs) {
    const key = `${p.section ?? 'other'}|${p.heading ?? ''}`
    let s = map.get(key)
    if (!s) {
      s = {
        canonical: p.section,
        heading: p.heading,
        chars: 0,
        approxTokens: 0,
        paragraphCount: 0,
        startOffset: p.startOffset,
        endOffset: p.endOffset,
        fraction: 0,
      }
      map.set(key, s)
    }
    s.chars += p.text.length
    s.paragraphCount += 1
    if (p.startOffset < s.startOffset) s.startOffset = p.startOffset
    if (p.endOffset > s.endOffset) s.endOffset = p.endOffset
  }

  const totalChars = raw.length || 1
  const sections: SectionStats[] = Array.from(map.values()).map(s => ({
    ...s,
    approxTokens: estimateTokens(s.chars),
    fraction: s.chars / totalChars,
  }))
  sections.sort((a, b) => a.startOffset - b.startOffset)

  const model = opts.model ?? 'gemini-2.5-flash'
  const noise = detectNoise(raw, doc.sections)
  const duplicationClusters = detectDuplicationClusters(paragraphs, opts.duplication)
  const extractionCandidates = detectExtractionCandidates(paragraphs)

  return {
    chars: raw.length,
    approxTokens: estimateTokens(raw.length),
    paragraphs,
    sections,
    budget: budgetFor(raw.length, model),
    noise,
    duplicationClusters,
    extractionCandidates,
  }
}

// Re-export CanonicalSection for callers importing from core/structure
export type { CanonicalSection }
