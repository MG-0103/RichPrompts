import type { Severity } from './types'
import type { ParsedTool } from './toolParser'
import { parseToolDocument } from './toolParser'
import { parseDocument } from './parser'
import { similarity } from './similarity'

export interface RegistryToolEntry {
  id: string
  raw: string
  parsed: ParsedTool
}

export interface RegistrySkillEntry {
  id: string
  raw: string
  name: string
  description: string
}

export interface Registry {
  tools: RegistryToolEntry[]
  skills: RegistrySkillEntry[]
}

export interface RegistryFinding {
  ruleId: string
  severity: Severity
  message: string
  docIds: [string, string]
  score: number
  fix?: string
}

export interface RegistryConfig {
  duplicateAuthorityThreshold: number
}

export const defaultRegistryConfig: RegistryConfig = {
  duplicateAuthorityThreshold: 0.55,
}

export function buildRegistry(
  toolRaw: { id: string; raw: string }[],
  skillRaw: { id: string; raw: string }[],
): Registry {
  const tools = toolRaw.map(({ id, raw }) => ({ id, raw, parsed: parseToolDocument(raw) }))
  const skills = skillRaw.map(({ id, raw }) => {
    const doc = parseDocument(raw, 'skill')
    const fm = doc.sections.find(s => s.kind === 'frontmatter')
    const nameMatch = fm?.text.match(/name:\s*(.+)/)
    const descMatch = fm?.text.match(/description:\s*([\s\S]*?)(?:\n\S|$)/)
    return {
      id,
      raw,
      name: nameMatch?.[1].trim() ?? id,
      description: descMatch?.[1].trim() ?? '',
    }
  })
  return { tools, skills }
}

export function runRegistryRules(
  registry: Registry,
  config: RegistryConfig = defaultRegistryConfig,
): RegistryFinding[] {
  const findings: RegistryFinding[] = []
  const threshold = config.duplicateAuthorityThreshold

  const toolDescs = registry.tools
    .filter(t => t.parsed.toolDescription)
    .map(t => ({ id: `tool:${t.parsed.toolName ?? t.id}`, text: t.parsed.toolDescription! }))
  findings.push(...pairwiseDuplicates(toolDescs, threshold, 'tool'))

  const skillDescs = registry.skills
    .filter(s => s.description)
    .map(s => ({ id: `skill:${s.name}`, text: s.description }))
  findings.push(...pairwiseDuplicates(skillDescs, threshold, 'skill'))

  return findings.sort((a, b) => b.score - a.score)
}

function pairwiseDuplicates(
  items: { id: string; text: string }[],
  threshold: number,
  kind: 'tool' | 'skill',
): RegistryFinding[] {
  const out: RegistryFinding[] = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const s = similarity(items[i].text, items[j].text)
      if (s < threshold) continue
      out.push({
        ruleId: 'registry/duplicate-authority',
        severity: s >= 0.75 ? 'warn' : 'info',
        message: `${kind} descriptions overlap (${(s * 100).toFixed(0)}%). Router will have no clear signal to pick between them.`,
        docIds: [items[i].id, items[j].id],
        score: s,
        fix: 'Rewrite each description to name what makes it uniquely applicable, or merge them.',
      })
    }
  }
  return out
}
