export type DocType = 'prompt' | 'tool' | 'skill'
export type Severity = 'error' | 'warn' | 'info'
export type SectionKind = 'heading' | 'xml' | 'frontmatter' | 'body'
/**
 * Extended canonical taxonomy (v2 spike).
 *
 *  Role family     — role, persona, style, tone
 *  Task family     — task, context
 *  Output family   — output, input
 *  Constraints     — constraints, reasoning, examples, guardrails
 *  Definitions     — tools, skills, agents
 *
 * The v1 shipping UI only paints role/task/output/constraints;
 * the newer labels resolve correctly through the parser and
 * missing-sections rule but currently render without a colored
 * gutter bar. UI extension is a separate follow-up.
 */
export type CanonicalSection =
  | 'role' | 'persona' | 'style' | 'tone'
  | 'task' | 'context'
  | 'output' | 'input'
  | 'constraints' | 'reasoning' | 'examples' | 'guardrails'
  | 'tools' | 'skills' | 'agents'

/**
 * Which fine-grained canonicals satisfy each of the four v1
 * "required" section slots. Used by the missing-sections rule so
 * that `persona` fills the role slot, `guardrails` fills the
 * constraints slot, etc.
 */
export const SECTION_FAMILY: Record<
  'role' | 'task' | 'output' | 'constraints',
  ReadonlyArray<CanonicalSection>
> = {
  role:        ['role', 'persona'],
  task:        ['task', 'context'],
  output:      ['output'],
  constraints: ['constraints', 'guardrails'],
} as const

export interface Section {
  kind: SectionKind
  name: string
  text: string
  startOffset: number
  endOffset: number
  canonical?: CanonicalSection
}

export interface ParsedDoc {
  docType: DocType
  raw: string
  sections: Section[]
  variables: string[]
}

export interface Range {
  startOffset: number
  endOffset: number
}

export interface RelatedInfo {
  message: string
  range: Range
}

export interface Diagnostic {
  ruleId: string
  severity: Severity
  message: string
  range: Range
  docsRef?: string
  fix?: string
  relatedInfo?: RelatedInfo[]
  /** Machine-readable payload for autofix and other tooling. Free-form
   *  per rule — see the rule's fix implementation for the schema. */
  data?: Record<string, unknown>
}

export interface RuleContext {
  config: RuleConfig
}

export interface Rule {
  id: string
  pack: 'prompt' | 'tool' | 'skill' | 'registry'
  defaultSeverity: Severity
  appliesTo: DocType[]
  docsRef?: string
  check: (doc: ParsedDoc, ctx: RuleContext) => Diagnostic[]
}

export interface RuleConfig {
  thresholds: {
    promptMaxChars: number
    instructionStackingMax: number
    emphaticTokensMax: number
    negativeInstructionsMax: number
  }
  severityOverrides: Record<string, Severity>
  disabled: string[]
}
