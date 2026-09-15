export type ExpectedTarget =
  | { kind: 'tool' | 'skill'; name: string }
  | { kind: 'none' }

export interface TestCase {
  id: string
  query: string
  expect: ExpectedTarget
  mustNotCall?: string[]
  notes?: string
}

export interface TestRunConfig {
  model?: string
  rollouts?: number
  temperature?: number
  mock?: boolean
}

export interface TestRunRequest {
  prompt: string
  tools: { id: string; raw: string }[]
  skills: { id: string; raw: string }[]
  testCases: TestCase[]
  config?: TestRunConfig
}

export interface RolloutOutcome {
  called: { kind: 'tool' | 'skill'; name: string } | { kind: 'none' } | null
  args?: Record<string, unknown>
  latencyMs: number
  steps: number
  logprob?: number
  error?: string
}

export interface TestResult {
  testId: string
  passRate: number
  meanLogprob?: number
  meanSteps: number
  latencyP50: number
  routingScore: number
  rollouts: RolloutOutcome[]
  mock?: boolean
}

export interface TestRunResponse {
  results: TestResult[]
  durationMs: number
  sidecarVersion: string
}
