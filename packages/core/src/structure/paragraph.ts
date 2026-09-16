import type { CanonicalSection, Section } from '../types'
import type { Paragraph } from './types'

/**
 * Split raw text into paragraphs — the unit of analysis for
 * duplication, noise, and extraction detectors.
 *
 * Rules:
 *   - A paragraph is one or more consecutive non-blank lines.
 *   - Blank lines are separators.
 *   - Each paragraph carries its byte offsets so downstream findings
 *     can jump the editor to the source range.
 *   - Each paragraph carries the canonical section it falls inside
 *     (if any), computed from the parser's section list.
 */
export function splitParagraphs(raw: string, sections: Section[] = []): Paragraph[] {
  const out: Paragraph[] = []
  const re = /([^\n]+(?:\n[^\n]+)*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const text = m[0]
    if (!text.trim()) continue
    const startOffset = m.index
    const endOffset = m.index + text.length
    const s = sectionAt(sections, startOffset)
    out.push({
      id: `p${out.length}`,
      text,
      startOffset,
      endOffset,
      section: s?.canonical,
      heading: s?.kind === 'heading' ? s.name : undefined,
    })
  }
  return out
}

function sectionAt(sections: Section[], offset: number): Section | undefined {
  // Prefer the innermost matching section — XML tags nest, headings don't.
  let best: Section | undefined
  let bestSpan = Infinity
  for (const s of sections) {
    if (offset < s.startOffset || offset >= s.endOffset) continue
    const span = s.endOffset - s.startOffset
    if (span < bestSpan) {
      best = s
      bestSpan = span
    }
  }
  return best
}

export function canonicalOf(p: Paragraph): CanonicalSection | 'other' {
  return p.section ?? 'other'
}
