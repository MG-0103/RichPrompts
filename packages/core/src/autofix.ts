/**
 * Deterministic autofixes for diagnostics that carry a `data.kind`
 * payload. Every fix is a pure string → string transformation so the
 * caller can preview, undo, or batch without stateful side effects.
 *
 * Currently implemented:
 *  - `undefined-variable`   → add the missing variable to the
 *                             frontmatter's `variables:` block, creating
 *                             the block or the whole frontmatter if
 *                             needed.
 *  - `missing-sections`     → insert a heading skeleton for each missing
 *                             canonical section, placed right after
 *                             frontmatter (or at the top of the doc when
 *                             there is none).
 *
 * Everything else returns the source unchanged; `isDiagnosticFixable`
 * tells the caller in advance.
 */

import type { CanonicalSection, Diagnostic } from './types'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

const CANONICAL_HEADINGS: Record<CanonicalSection, string> = {
  role: 'Role',
  task: 'Task',
  output: 'Output Format',
  constraints: 'Constraints',
}

const CANONICAL_ORDER: CanonicalSection[] = ['role', 'task', 'output', 'constraints']

export interface UndefinedVariableData {
  kind: 'undefined-variable'
  name: string
}

export interface MissingSectionsData {
  kind: 'missing-sections'
  missing: CanonicalSection[]
}

/** True when we have a deterministic autofix for this diagnostic. */
export function isDiagnosticFixable(d: Diagnostic): boolean {
  const kind = (d.data as { kind?: string } | undefined)?.kind
  return kind === 'undefined-variable' || kind === 'missing-sections'
}

/**
 * Apply the autofix for a diagnostic. When the diagnostic carries no
 * recognised `data.kind`, returns the source unchanged so callers can
 * safely fan out over a batch without pre-filtering.
 */
export function applyDiagnosticFix(source: string, d: Diagnostic): string {
  const data = d.data as { kind?: string } | undefined
  if (!data) return source
  switch (data.kind) {
    case 'undefined-variable':
      return fixUndefinedVariable(source, (data as UndefinedVariableData).name)
    case 'missing-sections':
      return fixMissingSections(source, (data as MissingSectionsData).missing)
    default:
      return source
  }
}

/**
 * Insert `- <name>` under the frontmatter's `variables:` list. Creates
 * the list, and the entire frontmatter block, when either is missing.
 * Idempotent — a name that's already declared is left alone.
 */
export function fixUndefinedVariable(source: string, name: string): string {
  if (!/^[a-zA-Z_][\w.-]*$/.test(name)) return source

  const fm = source.match(FRONTMATTER_RE)
  if (!fm) {
    const block = `---\nvariables:\n  - ${name}\n---\n`
    return block + source
  }

  const fmBody = fm[1]
  const varsMatch = fmBody.match(/^(\s*)variables:\s*\n((?:\s*-\s*.+\n?)*)/m)
  if (varsMatch) {
    const existing = varsMatch[2]
    // Already declared → no-op.
    for (const line of existing.split('\n')) {
      const m = line.match(/^\s*-\s*(\S+)/)
      if (m && m[1] === name) return source
    }
    const insertAt = fmBody.indexOf(varsMatch[0]) + varsMatch[0].length
    const rebuilt =
      fmBody.slice(0, insertAt).replace(/\n?$/, '\n') +
      `  - ${name}\n` +
      fmBody.slice(insertAt).replace(/^\n/, '')
    return source.replace(FRONTMATTER_RE, `---\n${rebuilt}\n---\n`)
  }

  // Frontmatter exists but has no `variables:` block yet.
  const trimmed = fmBody.replace(/\s+$/, '')
  const rebuilt = `${trimmed}\nvariables:\n  - ${name}`
  return source.replace(FRONTMATTER_RE, `---\n${rebuilt}\n---\n`)
}

/**
 * Insert `## <Heading>\n\n\n\n` for each missing canonical section,
 * placed right after frontmatter (or at the very top of the doc when
 * there is none). Order follows the canonical order (role → task →
 * output → constraints); already-present sections in the list are
 * skipped as a defensive measure.
 */
export function fixMissingSections(
  source: string,
  missing: CanonicalSection[],
): string {
  if (missing.length === 0) return source
  const ordered = CANONICAL_ORDER.filter(s => missing.includes(s))
  const skeleton = ordered
    .map(s => `## ${CANONICAL_HEADINGS[s]}\n\n\n`)
    .join('\n')

  const fm = source.match(FRONTMATTER_RE)
  if (fm && source.startsWith(fm[0])) {
    const insertAt = fm[0].length
    const suffix = source.slice(insertAt)
    // If body already starts with content, put a blank line between
    // the skeleton and it; if the source ends at the frontmatter, don't
    // trail extra newlines.
    const gap = suffix.trimStart().length === 0 ? '' : '\n'
    return source.slice(0, insertAt) + skeleton + gap + suffix.replace(/^\n+/, '')
  }
  const gap = source.trimStart().length === 0 ? '' : '\n'
  return skeleton + gap + source.replace(/^\n+/, '')
}
