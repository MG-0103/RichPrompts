import { defaultConfig, type RuleConfig } from '@richprompt/core'

const KEY = 'richprompt.config.v1'

export function loadConfig(): RuleConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultConfig
    const parsed = JSON.parse(raw) as Partial<RuleConfig>
    return {
      thresholds: { ...defaultConfig.thresholds, ...(parsed.thresholds ?? {}) },
      disabled: parsed.disabled ?? [],
      severityOverrides: parsed.severityOverrides ?? {},
    }
  } catch {
    return defaultConfig
  }
}

export function saveConfig(cfg: RuleConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)) } catch { /* quota */ }
}

export function resetConfig() {
  localStorage.removeItem(KEY)
}
