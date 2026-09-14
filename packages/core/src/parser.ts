import type { DocType, ParsedDoc, Section } from './types'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm
const XML_OPEN_RE = /<([a-zA-Z][\w:-]*)\b[^>]*>/g
const VAR_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g

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
    })
  }

  const variables = Array.from(new Set(Array.from(raw.matchAll(VAR_RE), m => m[1])))

  return { docType, raw, sections, variables }
}
