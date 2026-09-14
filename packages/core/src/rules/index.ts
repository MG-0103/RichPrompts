import { patternRules } from './patterns'
import { structuralRules } from './structural'
import { toolRules } from './tool'
import { skillRules } from './skill'
import type { DocType, Rule } from '../types'

export const promptRules: Rule[] = [...structuralRules, ...patternRules]
export const toolPackRules: Rule[] = [...toolRules, ...patternRules.filter(r => r.appliesTo.includes('tool'))]
export const skillPackRules: Rule[] = [
  ...skillRules,
  ...structuralRules.filter(r => r.appliesTo.includes('skill')),
  ...patternRules.filter(r => r.appliesTo.includes('skill')),
]

export function rulesFor(docType: DocType): Rule[] {
  switch (docType) {
    case 'tool': return toolPackRules
    case 'skill': return skillPackRules
    default: return promptRules
  }
}

export { structuralRules, patternRules, toolRules, skillRules }
