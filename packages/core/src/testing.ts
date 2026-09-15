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
  /** Fraction of rollouts that landed on the modal call. High
   *  concentration + low pass rate = confidently wrong. */
  concentration: number
  /** What the model picked most often, whether or not it matched
   *  the expectation. `null` when the model tied across rollouts
   *  or produced only errors. */
  modalCalled: RolloutOutcome['called']
  /** Not populated on Gemini function-call responses yet — kept
   *  optional for phase-12.x reranking-probe experiments. */
  meanLogprob?: number
  meanSteps: number
  latencyP50: number
  routingScore: number
  rollouts: RolloutOutcome[]
  /** Was this served from cache? */
  cached?: boolean
  mock?: boolean
}

export interface TestRunResponse {
  results: TestResult[]
  durationMs: number
  sidecarVersion: string
}
