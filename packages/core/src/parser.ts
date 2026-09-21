import type { CanonicalSection, DocType, ParsedDoc, Section } from './types'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm
const XML_OPEN_RE = /<([a-zA-Z][\w:-]*)\b[^>]*>/g
const VAR_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g

const CANONICAL_PATTERNS: Array<{ canonical: CanonicalSection; re: RegExp }> = [
  { canonical: 'role',        re: /\b(role|persona|you are|identity)\b/i },
  { canonical: 'task',        re: /\b(task|goal|objective|instructions?|job)\b/i },
  { canonical: 'output',      re: /\b(output|format|response|response[- ]format|schema)\b/i },
  { canonical: 'constraints', re: /\b(constraints?|rules?|requirements?|guidelines?|policies?|limitations?)\b/i },
]

export function classifyCanonical(name: string): CanonicalSection | undefined {
  const lowered = name.toLowerCase()
  for (const { canonical, re } of CANONICAL_PATTERNS) {
    if (re.test(lowered)) return canonical
  }
  return undefined
}

/** Strong opening-line patterns that identify a paragraph's canonical
 *  role even without an explicit heading. Deliberately strict — each
 *  pattern requires a distinctive introductory phrase or a labelled
 *  list, so incidental prose doesn't false-positive. */
const BODY_PATTERNS: Array<{ canonical: CanonicalSection; re: RegExp }> = [
  {
    canonical: 'role',
    re: /(?:^|\n)\s*(?:you\s+are\b|you'?re\s+(?:a|an|the)\b|act\s+as\b|your\s+persona\b|identity\s*[:.-])/i,
  },
  {
    canonical: 'task',
    re: /(?:^|\n)\s*(?:your\s+(?:task|job|goal|objective|primary\s+function|responsibility)\s+is\b|the\s+task\s+is\b|task\s*[:.-]|objective\s*[:.-]|goal\s*[:.-])/i,
  },
  {
    canonical: 'output',
    re: /(?:^|\n)\s*(?:output\s+format|response\s+format|return\s+(?:a|an|the)?\s*(?:json|xml|list|structured|markdown)|format\s*[:.-]|schema\s*[:.-])/i,
  },
  {
    canonical: 'constraints',
    re: /(?:^|\n)\s*(?:constraints?|rules?|requirements?|guidelines?|policies?|limitations?|restrictions?)\s*[:.\-]/i,
  },
]

/** Scan raw text for strong canonical-signalling opening lines. Used
 *  as a fallback when no heading of that canonical is present. */
export function inferBodyCanonicals(raw: string): Set<CanonicalSection> {
  const out = new Set<CanonicalSection>()
  for (const { canonical, re } of BODY_PATTERNS) {
    if (re.test(raw)) out.add(canonical)
  }
  return out
}

export function parseDocument(raw: string, docType: DocType = 'prompt'): ParsedDoc {
  const sections: Section[] = []
  let cursor = 0

  const fm = raw.match(FRONTMATTER_RE)
  if (fm && raw.startsWith(fm[0])) {
    sections.push({
      kind: 'frontmatter',
      name: 'frontmatter',
      text: fm[1],
      startOffset: 0,
      endOffset: fm[0].length,
    })
    cursor = fm[0].length
  }

  const body = raw.slice(cursor)
  const headingHits: { name: string; start: number; end: number }[] = []
  for (const m of body.matchAll(HEADING_RE)) {
    if (m.index === undefined) continue
    headingHits.push({
      name: m[2].trim(),
      start: cursor + m.index,
      end: cursor + m.index + m[0].length,
    })
  }

  for (let i = 0; i < headingHits.length; i++) {
    const h = headingHits[i]
    const next = headingHits[i + 1]
    const sectionEnd = next ? next.start : raw.length
    sections.push({
      kind: 'heading',
      name: h.name,
      text: raw.slice(h.end, sectionEnd).trim(),
      startOffset: h.start,
      endOffset: sectionEnd,
      canonical: classifyCanonical(h.name),
    })
  }

  for (const m of raw.matchAll(XML_OPEN_RE)) {
    if (m.index === undefined) continue
    const tag = m[1]
    const closeRe = new RegExp(`</${tag}>`, 'g')
    closeRe.lastIndex = m.index + m[0].length
    const closeMatch = closeRe.exec(raw)
    if (!closeMatch) continue
    sections.push({
      kind: 'xml',
      name: tag,
      text: raw.slice(m.index + m[0].length, closeMatch.index),
      startOffset: m.index,
      endOffset: closeMatch.index + closeMatch[0].length,
      canonical: classifyCanonical(tag),
    })
  }

  const variables = Array.from(new Set(Array.from(raw.matchAll(VAR_RE), m => m[1])))

  return { docType, raw, sections, variables }
}
