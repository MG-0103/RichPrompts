export * from './types'
export {
  applyDiagnosticFix,
  isDiagnosticFixable,
  fixUndefinedVariable,
  fixMissingSections,
} from './autofix'
export type { UndefinedVariableData, MissingSectionsData } from './autofix'
export { defaultConfig } from './config'
export { parseDocument, classifyCanonical, inferBodyCanonicals } from './parser'
export { parseToolDocument } from './toolParser'
export type { ParsedTool, ToolParam } from './toolParser'
export { runRules } from './engine'
export {
  promptRules,
  toolPackRules,
  skillPackRules,
  structuralRules,
  patternRules,
  toolRules,
  skillRules,
  allRules,
  rulesFor,
} from './rules'
export { badPrompt } from './fixtures/badPrompt'
export { goodPrompt } from './fixtures/goodPrompt'
export { badTool } from './fixtures/badTool'
export { badSkill } from './fixtures/badSkill'
export { sampleRegistryTools, sampleRegistrySkills } from './fixtures/sampleRegistry'
export {
  buildRegistry,
  runRegistryRules,
  defaultRegistryConfig,
} from './registry'
export type {
  Registry,
  RegistryToolEntry,
  RegistrySkillEntry,
  RegistryFinding,
  RegistryConfig,
} from './registry'
export { similarity, trigrams, jaccard, cosineSimilarity } from './similarity'
export { scoreDiagnostics, hashContent, defaultWeights } from './score'
export type { ScoreBreakdown, ScoreWeights } from './score'
export type {
  TestCase,
  ExpectedTarget,
  TestRunConfig,
  TestRunRequest,
  TestRunResponse,
  TestResult,
  RolloutOutcome,
} from './testing'
export type { Version, VersionKind } from './version'
export {
  analyzeStructure,
  budgetFor,
  estimateTokens,
  splitParagraphs,
  detectNoise,
  applyNoiseFix,
  isNoiseFixable,
  detectDuplicationClusters,
  analyzeDuplication,
  clusterByPairwiseSimilarity,
  detectExtractionCandidates,
  adviceFor,
} from './structure'
export type {
  AnalyzeOptions,
  BudgetInfo,
  Paragraph,
  SectionStats,
  StructureReport,
  NoiseFlag,
  NoiseKind,
  DuplicationCluster,
  DuplicationEdge,
  DuplicationAnalysis,
  DuplicationOptions,
  ExtractionCandidate,
  ExtractionTarget,
} from './structure'

import { parseDocument } from './parser'
import { parseToolDocument } from './toolParser'
import { runRules } from './engine'
import { rulesFor } from './rules'
import { defaultConfig } from './config'
import type { DocType, Diagnostic, RuleConfig } from './types'

export function lint(
  raw: string,
  docType: DocType = 'prompt',
  config: RuleConfig = defaultConfig,
): Diagnostic[] {
  const doc = docType === 'tool' ? parseToolDocument(raw) : parseDocument(raw, docType)
  return runRules(doc, rulesFor(docType), config)
}
