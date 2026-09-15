/**
 * Extract the callable names a routing test can target from the current
 * registry. Names must match what the sidecar will see, so skills are
 * sanitized with the same regex as `real_runner._skill_to_decl`.
 */

export type CallTarget = { kind: 'tool' | 'skill'; name: string }

const SKILL_NAME_SAN = /[^a-zA-Z0-9_]/g

export function toolNamesFrom(tools: { id: string; raw: string }[]): string[] {
  const names: string[] = []
  for (const t of tools) {
    try {
      const parsed = JSON.parse(t.raw) as { name?: unknown }
      if (typeof parsed.name === 'string' && parsed.name) names.push(parsed.name)
    } catch { /* skip malformed */ }
  }
  return names
}

export function skillNamesFrom(skills: { id: string; raw: string }[]): string[] {
  const names: string[] = []
  for (const s of skills) {
    const fm = s.raw.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fm) continue
    const nameLine = fm[1].match(/^name:\s*(.+)$/m)
    const raw = (nameLine?.[1] ?? s.id).trim()
    const sanitized = raw.replace(SKILL_NAME_SAN, '_').replace(/^_+|_+$/g, '')
    if (sanitized) names.push(sanitized)
  }
  return names
}

export function callTargets(
  tools: { id: string; raw: string }[],
  skills: { id: string; raw: string }[],
): CallTarget[] {
  return [
    ...toolNamesFrom(tools).map(name => ({ kind: 'tool' as const, name })),
    ...skillNamesFrom(skills).map(name => ({ kind: 'skill' as const, name })),
  ]
}
