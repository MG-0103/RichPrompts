import type { Section } from '../types'

export type NoiseKind =
  | 'html-comment'
  | 'author-marker'
  | 'placeholder'
  | 'empty-xml-tag'
  | 'blank-run'
  | 'boilerplate-tail'

export interface NoiseFlag {
  id: string
  kind: NoiseKind
  message: string
  suggestion: string
  range: { startOffset: number; endOffset: number }
}

const PATTERNS: Array<{
  kind: NoiseKind
  re: RegExp
  message: string
  suggestion: string
}> = [
  {
    kind: 'html-comment',
    re: /<!--[\s\S]*?-->/g,
    message: 'HTML comment left in the prompt',
    suggestion: 'Delete — comments consume tokens without affecting behavior.',
  },
  {
    kind: 'author-marker',
    re: /\b(TODO|FIXME|XXX|HACK)\b[^\n]{0,120}/g,
    message: 'Author marker still present',
    suggestion: 'Address or remove before shipping.',
  },
  {
    kind: 'placeholder',
    re: /\[(?:REDACTED|PLACEHOLDER|TBD|TODO|FILL[- ]?IN|INSERT)\]/gi,
    message: 'Placeholder token — unfilled slot in the prompt',
    suggestion: 'Replace with the intended content or remove.',
  },
  {
    kind: 'empty-xml-tag',
    re: /<([a-zA-Z][\w:-]*)>\s*<\/\1>/g,
    message: 'Empty XML tag',
    suggestion: 'Delete — the tag adds structure noise without content.',
  },
  {
    kind: 'blank-run',
    re: /\n[ \t]*\n[ \t]*(?:\n[ \t]*){2,}/g,
    message: 'Run of 3+ blank lines',
    suggestion: 'Collapse to one blank line.',
  },
]

/**
 * Boilerplate phrases we only flag in the trailing region OR when the
 * prompt already has a canonical Role section stating the persona.
 * Position-aware gating cuts false positives on legitimate role
 * definitions at the top.
 */
const BOILERPLATE_TAIL = [
  /you are (a )?helpful[,]? ?(harmless[,]? ?)?(and )?(honest )?assistant/i,
  /be polite( and respectful)?/i,
  /(do not|don't|never) lie( or make (things|it) up)?/i,
  /always be (truthful|helpful|honest)/i,
  /(i hope|hope this) helps/i,
]

const BOILERPLATE_TAIL_WINDOW = 800  // trailing chars

export function detectNoise(raw: string, sections: Section[] = []): NoiseFlag[] {
  const out: NoiseFlag[] = []
  let id = 0

  for (const p of PATTERNS) {
    for (const m of raw.matchAll(p.re)) {
      if (m.index === undefined) continue
      out.push({
        id: `n${id++}`,
        kind: p.kind,
        message: p.message,
        suggestion: p.suggestion,
        range: { startOffset: m.index, endOffset: m.index + m[0].length },
      })
    }
  }

  // Boilerplate — flag matches in the trailing window. Skip the
  // primary persona line inside a Role section (that's the one
  // canonical spot the phrasing is expected).
  const roleSections = sections.filter(s => s.canonical === 'role')
  const hasRoleSection = roleSections.length > 0
  const canonicalPersonaOffset = findCanonicalPersonaOffset(raw, roleSections)
  const tailStart = Math.max(0, raw.length - BOILERPLATE_TAIL_WINDOW)

  for (const re of BOILERPLATE_TAIL) {
    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of raw.matchAll(globalRe)) {
      if (m.index === undefined) continue
      const abs = m.index
      if (canonicalPersonaOffset !== null && abs === canonicalPersonaOffset) continue
      // Only fire in the tail window unless a Role section exists (then
      // any duplicate boilerplate outside the canonical persona is fair game).
      if (abs < tailStart && !hasRoleSection) continue
      out.push({
        id: `n${id++}`,
        kind: 'boilerplate-tail',
        message: `Generic boilerplate: "${m[0].slice(0, 60)}${m[0].length > 60 ? '…' : ''}"`,
        suggestion: hasRoleSection
          ? 'Persona is already declared in the Role section — this trailing statement is redundant.'
          : 'Move to a Role section if intentional, otherwise remove.',
        range: { startOffset: abs, endOffset: abs + m[0].length },
      })
    }
  }

  // De-dupe overlapping ranges (e.g. author-marker inside html-comment)
  return dedupeByRange(out)
}

/**
 * Return the absolute offset of the first "You are …" occurrence inside
 * any Role section — that occurrence is the canonical persona line and
 * shouldn't be flagged as boilerplate.
 */
function findCanonicalPersonaOffset(raw: string, roleSections: Section[]): number | null {
  for (const s of roleSections) {
    const body = raw.slice(s.startOffset, s.endOffset)
    const m = body.match(/you are/i)
    if (m && m.index !== undefined) return s.startOffset + m.index
  }
  return null
}

/**
 * Apply the "safe delete" autofix for a noise flag. Every noise kind
 * except `blank-run` removes the flagged range outright plus any single
 * trailing newline (to avoid leaving a blank line where a comment used
 * to be). `blank-run` collapses to exactly one blank line (two `\n`).
 *
 * Boilerplate is kept out of the safe-delete set intentionally — its
 * removal often needs the user to move the persona line first, so we
 * only surface the finding, not a one-click fix.
 */
export function applyNoiseFix(source: string, flag: NoiseFlag): string {
  const { startOffset, endOffset } = flag.range
  if (startOffset < 0 || endOffset > source.length || endOffset < startOffset) {
    return source
  }
  if (flag.kind === 'blank-run') {
    return source.slice(0, startOffset) + '\n\n' + source.slice(endOffset)
  }
  if (flag.kind === 'boilerplate-tail') {
    // Not a safe unattended fix — bail out unchanged.
    return source
  }
  let cut = endOffset
  if (source[cut] === '\n') cut += 1
  return source.slice(0, startOffset) + source.slice(cut)
}

/** True when this flag has a deterministic autofix wired up. */
export function isNoiseFixable(flag: NoiseFlag): boolean {
  return flag.kind !== 'boilerplate-tail'
}

function dedupeByRange(flags: NoiseFlag[]): NoiseFlag[] {
  flags.sort((a, b) =>
    a.range.startOffset - b.range.startOffset ||
    (b.range.endOffset - b.range.startOffset) - (a.range.endOffset - a.range.startOffset),
  )
  const kept: NoiseFlag[] = []
  for (const f of flags) {
    const overlaps = kept.some(k =>
      f.range.startOffset >= k.range.startOffset &&
      f.range.endOffset <= k.range.endOffset,
    )
    if (!overlaps) kept.push(f)
  }
  return kept
}
