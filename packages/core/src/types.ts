export type DocType = 'prompt' | 'tool' | 'skill'
export type Severity = 'error' | 'warn' | 'info'
export type SectionKind = 'heading' | 'xml' | 'frontmatter' | 'body'

export interface Section {
  kind: SectionKind
  name: string
  text: string
  startOffset: number
  endOffset: number
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
