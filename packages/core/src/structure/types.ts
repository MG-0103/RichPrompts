import type { CanonicalSection } from '../types'

export interface Paragraph {
  id: string
  text: string
  startOffset: number
  endOffset: number
  /** Canonical section this paragraph falls inside, if any. */
  section?: CanonicalSection
  /** Raw heading text if the paragraph is inside a headed section. */
  heading?: string
}

export interface SectionStats {
  /** Undefined for uncategorized headings. */
  canonical?: CanonicalSection
  heading?: string
  chars: number
  approxTokens: number
  paragraphCount: number
  startOffset: number
  endOffset: number
  /** 0..1 fraction of the whole prompt. */
  fraction: number
}

export interface BudgetInfo {
  model: string
  contextWindow: number
  /** Practical attention budget in tokens. */
  practicalTokens: number
  approxTokens: number
  /** approxTokens / practicalTokens, clamped to 4x for display. */
  percentUsed: number
  /** 'good' <= 60%, 'ok' <= 100%, 'bad' > 100% */
  tone: 'good' | 'ok' | 'bad'
}

export interface StructureReport {
  chars: number
  approxTokens: number
  paragraphs: Paragraph[]
  sections: SectionStats[]
  budget: BudgetInfo
  noise: import('./noise').NoiseFlag[]
  duplicationClusters: import('./duplication').DuplicationCluster[]
  duplicationEdges: import('./duplication').DuplicationEdge[]
  extractionCandidates: import('./extract').ExtractionCandidate[]
}
