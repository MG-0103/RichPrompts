import { patternRules } from './patterns'
import { structuralRules } from './structural'
import type { Rule } from '../types'

export const promptRules: Rule[] = [...structuralRules, ...patternRules]
export { structuralRules, patternRules }
