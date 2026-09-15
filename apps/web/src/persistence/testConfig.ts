export interface TestingConfig {
  rollouts: number
  temperature: number
  model: string
  ablation: boolean
}

const KEY = 'richprompt.tests.config.v1'

export const DEFAULT_TESTING_CONFIG: TestingConfig = {
  rollouts: 5,
  temperature: 0.7,
  model: 'gemini-2.5-flash',
  ablation: false,
}

export function loadTestingConfig(): TestingConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_TESTING_CONFIG }
    const parsed = JSON.parse(raw) as Partial<TestingConfig>
    return {
      rollouts: clamp(parsed.rollouts ?? DEFAULT_TESTING_CONFIG.rollouts, 1, 20),
      temperature: clamp(parsed.temperature ?? DEFAULT_TESTING_CONFIG.temperature, 0, 2),
      model: parsed.model?.trim() || DEFAULT_TESTING_CONFIG.model,
      ablation: !!parsed.ablation,
    }
  } catch {
    return { ...DEFAULT_TESTING_CONFIG }
  }
}

export function saveTestingConfig(cfg: TestingConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)) } catch { /* ignore */ }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
