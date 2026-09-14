import type { RuleConfig } from './types'

export const defaultConfig: RuleConfig = {
  thresholds: {
    promptMaxChars: 12000,
    instructionStackingMax: 40,
    emphaticTokensMax: 3,
    negativeInstructionsMax: 2,
  },
  severityOverrides: {},
  disabled: [],
}
