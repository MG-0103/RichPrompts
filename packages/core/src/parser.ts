import type { CanonicalSection, DocType, ParsedDoc, Section } from './types'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm
const XML_OPEN_RE = /<([a-zA-Z][\w:-]*)\b[^>]*>/g
const VAR_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g

/**
 * Heading/XML-tag name → canonical section.
 *
 * Order matters — the first pattern that matches wins. Compound and
 * multi-word patterns come first so specific labels (e.g.
 * "output format" → output, "tool use rules" → constraints) beat
 * bare-word singles that would otherwise steal the match.
 */
const CANONICAL_PATTERNS: Array<{ canonical: CanonicalSection; re: RegExp }> = [
  // --- Compound / multi-word (specific first) ---
  { canonical: 'constraints', re: /\b(tool[_ ]use[_ ]rules?|editing[_ ]conventions?|coding[_ ]conventions?|style[_ ]conventions?|communication[_ ]rules?|communication[_ ]guidelines?)\b/i },
  { canonical: 'output',      re: /\b(output[_ ]format|response[_ ]format|output[_ ]schema|response[_ ]schema)\b/i },
  { canonical: 'reasoning',   re: /\b(reasoning[_ ]approach|thinking[_ ]approach|chain[_ -]of[_ -]thought|thinking[_ ]style)\b/i },
  { canonical: 'context',     re: /\b(context|background)\b/i },

  // --- Role family ---
  { canonical: 'persona',     re: /\b(persona|identity)\b/i },
  { canonical: 'style',       re: /\b(style|voice|writing[_ ]style)\b/i },
  { canonical: 'tone',        re: /\b(tone|register|mood)\b/i },
  { canonical: 'role',        re: /\b(role|you[_ ]are)\b/i },

  // --- Reasoning / examples ---
  { canonical: 'reasoning',   re: /\b(reasoning|thinking|cot)\b/i },
  { canonical: 'examples',    re: /\b(examples?|few[_ -]shots?|demonstrations?)\b/i },

  // --- Guardrails (checked before constraints so 'safety' etc. map here) ---
  { canonical: 'guardrails',  re: /\b(guardrails?|safety|refusals?|refuse|do[_ ]not[_ ]answer)\b/i },

  // --- Task family ---
  { canonical: 'task',        re: /\b(task|goal|objective|instructions?|job|workflow)\b/i },

  // --- Definitions ---
  { canonical: 'agents',      re: /\b(agents?|sub[_ -]?agents?|delegations?)\b/i },
  { canonical: 'skills',      re: /\b(skills?)\b/i },
  { canonical: 'tools',       re: /\b(tools?)\b/i },

  // --- Input ---
  { canonical: 'input',       re: /\b(input|user[_ ]input|data|content|query|documents?)\b/i },

  // --- Constraints (broad singles last so specific labels win first) ---
  { canonical: 'constraints', re: /\b(constraints?|rules?|requirements?|guidelines?|policies?|limitations?|restrictions?|communication|conventions?)\b/i },

  // --- Output singles ---
  { canonical: 'output',      re: /\b(output|response|schema|format)\b/i },
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
  // Role family
  {
    canonical: 'role',
    re: /(?:^|\n)\s*(?:you\s+are\b|you'?re\s+(?:a|an|the)\b|act\s+as\b)/i,
  },
  {
    canonical: 'persona',
    re: /(?:^|\n)\s*(?:your\s+persona\b|persona\s*[:.-]|identity\s*[:.-])/i,
  },
  {
    canonical: 'style',
    re: /(?:^|\n)\s*(?:writing\s+style|style\s*[:.-]|voice\s*[:.-])/i,
  },
  {
    canonical: 'tone',
    re: /(?:^|\n)\s*(?:tone\s*[:.-]|register\s*[:.-])/i,
  },

  // Task / context
  {
    canonical: 'task',
    re: /(?:^|\n)\s*(?:your\s+(?:task|job|goal|objective|primary\s+function|responsibility)\s+is\b|the\s+task\s+is\b|task\s*[:.-]|objective\s*[:.-]|goal\s*[:.-]|your\s+job\s*[:.-])/i,
  },
  {
    canonical: 'context',
    re: /(?:^|\n)\s*(?:context\s*[:.-]|background\s*[:.-])/i,
  },

  // Output / input
  {
    canonical: 'output',
    re: /(?:^|\n)\s*(?:output\s+format|response\s+format|return\s+(?:a|an|the)?\s*(?:json|xml|list|structured|markdown)|respond\s+(?:in|with)|format\s*[:.-]|schema\s*[:.-])/i,
  },
  {
    canonical: 'input',
    re: /(?:^|\n)\s*(?:the\s+user\s+will\s+(?:provide|send|paste|share)|input\s*[:.-]|user\s+input\s*[:.-])/i,
  },

  // Constraints / reasoning / guardrails
  {
    canonical: 'constraints',
    re: /(?:^|\n)\s*(?:constraints?|rules?|requirements?|guidelines?|policies?|limitations?|restrictions?)\s*[:.\-]/i,
  },
  {
    canonical: 'reasoning',
    re: /(?:^|\n)\s*(?:reasoning\s+approach|think\s+step\s+by\s+step|chain[- ]of[- ]thought|before\s+(?:responding|answering).*(?:think|work)|reasoning\s*[:.-])/i,
  },
  {
    canonical: 'guardrails',
    re: /(?:^|\n)\s*(?:refuse\s+to\s+(?:help|answer)|do\s+not\s+answer|safety\s*[:.-]|guardrails?\s*[:.-])/i,
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
