#!/usr/bin/env node
/**
 * Phase 0 eval harness — runs the v1 pipeline against the labelled
 * corpus and reports precision/recall per finding type. This is the
 * baseline every subsequent v2 phase measures against.
 *
 * Run: `npx tsx packages/core/scripts/eval-v1.ts`
 * Filter to one prompt: `... -- --prompt two-agent-defs`
 * JSON output: `... -- --json > eval.json`
 */

import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  analyzeStructure,
  parseDocument,
  splitParagraphs,
  detectDuplicationClusters,
  type CanonicalSection,
} from '../src/index'

// --------- Types ---------

interface LabelSection {
  anchor: string
  until?: string
  label: CanonicalSection | 'persona' | 'style' | 'tone' | 'context'
    | 'input' | 'reasoning' | 'guardrails' | 'tools' | 'skills' | 'agents'
}
interface LabelPair {
  texts: string[]
  note?: string
}
interface PromptLabels {
  file: string
  source: string
  sourceUrl?: string
  notes?: string
  sections: LabelSection[]
  duplicates: LabelPair[]
  contradictions: LabelPair[]
  relatedNotDuplicate: LabelPair[]
}
interface Labels {
  version: number
  prompts: Record<string, PromptLabels>
}

interface ResolvedSection {
  start: number
  end: number
  label: string
}
interface ResolvedPromptLabels {
  id: string
  source: string
  raw: string
  sections: ResolvedSection[]
  duplicates: { spans: Array<[number, number]>; note?: string }[]
  contradictions: { spans: Array<[number, number]>; note?: string }[]
  relatedNotDuplicate: { spans: Array<[number, number]>; note?: string }[]
}

interface EvalResult {
  promptId: string
  source: string
  sections: { precision: number; recall: number; expected: number; predicted: number; correct: number }
  duplicates: { precision: number; recall: number; expected: number; predicted: number; correct: number }
  relatedFalsePositives: { falsePositives: number; total: number }
}

// --------- Utilities ---------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CORPUS_DIR = join(__dirname, '..', 'src', '__tests__', 'corpus')

function resolveAnchor(raw: string, anchor: string, name: string): number {
  const idx = raw.indexOf(anchor)
  if (idx < 0) throw new Error(`[${name}] anchor not found: ${JSON.stringify(anchor.slice(0, 60))}`)
  const second = raw.indexOf(anchor, idx + 1)
  if (second >= 0) throw new Error(`[${name}] anchor is ambiguous (appears >1 times): ${JSON.stringify(anchor.slice(0, 60))}`)
  return idx
}

function loadCorpus(): ResolvedPromptLabels[] {
  const labelsRaw = readFileSync(join(CORPUS_DIR, 'labels.json'), 'utf8')
  const labels = JSON.parse(labelsRaw) as Labels
  const out: ResolvedPromptLabels[] = []
  for (const [id, entry] of Object.entries(labels.prompts)) {
    const raw = readFileSync(join(CORPUS_DIR, entry.file), 'utf8')
    const sections: ResolvedSection[] = []
    for (const s of entry.sections) {
      const start = resolveAnchor(raw, s.anchor, `${id}:section`)
      const end = s.until ? resolveAnchor(raw, s.until, `${id}:section-until`) : raw.length
      if (end <= start) throw new Error(`[${id}] section end <= start for anchor ${JSON.stringify(s.anchor.slice(0, 40))}`)
      sections.push({ start, end, label: s.label })
    }
    const resolveSpans = (pair: LabelPair, kind: string) => {
      const spans: Array<[number, number]> = []
      for (const t of pair.texts) {
        const start = resolveAnchor(raw, t, `${id}:${kind}`)
        spans.push([start, start + t.length])
      }
      return { spans, note: pair.note }
    }
    out.push({
      id,
      source: entry.source,
      raw,
      sections,
      duplicates: entry.duplicates.map(p => resolveSpans(p, 'duplicate')),
      contradictions: entry.contradictions.map(p => resolveSpans(p, 'contradiction')),
      relatedNotDuplicate: entry.relatedNotDuplicate.map(p => resolveSpans(p, 'relatedNotDup')),
    })
  }
  return out
}

// --------- Scoring ---------

/** A predicted section counts as correct when its label matches AND
 *  its start/end overlap the expected section by ≥ 50% of the smaller
 *  span. Loose overlap tolerance because heading detection often
 *  aligns to the heading line, not the body. */
function scoreSections(
  expected: ResolvedSection[],
  predicted: ResolvedSection[],
): EvalResult['sections'] {
  let correct = 0
  const usedPredIdx = new Set<number>()
  for (const exp of expected) {
    for (let i = 0; i < predicted.length; i++) {
      if (usedPredIdx.has(i)) continue
      const pred = predicted[i]
      if (pred.label !== exp.label) continue
      const overlapStart = Math.max(exp.start, pred.start)
      const overlapEnd = Math.min(exp.end, pred.end)
      const overlap = Math.max(0, overlapEnd - overlapStart)
      const smaller = Math.min(exp.end - exp.start, pred.end - pred.start)
      if (smaller > 0 && overlap / smaller >= 0.5) {
        correct++
        usedPredIdx.add(i)
        break
      }
    }
  }
  const expectedN = expected.length
  const predictedN = predicted.length
  return {
    precision: predictedN === 0 ? 1 : correct / predictedN,
    recall: expectedN === 0 ? 1 : correct / expectedN,
    expected: expectedN,
    predicted: predictedN,
    correct,
  }
}

/** A predicted duplicate cluster counts as correct when it contains
 *  ≥ 2 spans that overlap an expected duplicate pair. Uses paragraph
 *  ranges from the v1 pipeline. */
function scoreDuplicates(
  expected: { spans: Array<[number, number]> }[],
  predictedSpans: Array<Array<[number, number]>>,
): EvalResult['duplicates'] {
  const overlap = (a: [number, number], b: [number, number]) => {
    const s = Math.max(a[0], b[0])
    const e = Math.min(a[1], b[1])
    return Math.max(0, e - s) > 0
  }
  let correct = 0
  const usedPredIdx = new Set<number>()
  for (const exp of expected) {
    for (let i = 0; i < predictedSpans.length; i++) {
      if (usedPredIdx.has(i)) continue
      const pred = predictedSpans[i]
      // Every expected span must overlap SOME predicted span.
      const covered = exp.spans.every(es => pred.some(ps => overlap(es, ps)))
      if (covered) {
        correct++
        usedPredIdx.add(i)
        break
      }
    }
  }
  return {
    precision: predictedSpans.length === 0 ? 1 : correct / predictedSpans.length,
    recall: expected.length === 0 ? 1 : correct / expected.length,
    expected: expected.length,
    predicted: predictedSpans.length,
    correct,
  }
}

/** False positive count: how many predicted duplicate clusters actually
 *  match a labelled related-not-duplicate pair. These are the cases
 *  the pipeline MUST NOT flag as duplicates. */
function countRelatedFalsePositives(
  relatedPairs: { spans: Array<[number, number]> }[],
  predictedSpans: Array<Array<[number, number]>>,
): { falsePositives: number; total: number } {
  const overlap = (a: [number, number], b: [number, number]) => {
    const s = Math.max(a[0], b[0])
    const e = Math.min(a[1], b[1])
    return Math.max(0, e - s) > 0
  }
  let fp = 0
  for (const rel of relatedPairs) {
    for (const pred of predictedSpans) {
      const covered = rel.spans.every(rs => pred.some(ps => overlap(rs, ps)))
      if (covered) {
        fp++
        break
      }
    }
  }
  return { falsePositives: fp, total: relatedPairs.length }
}

// --------- V1 pipeline runner ---------

function runV1(raw: string) {
  const doc = parseDocument(raw, 'prompt')
  const paragraphs = splitParagraphs(raw, doc.sections)
  const clusters = detectDuplicationClusters(paragraphs)
  const report = analyzeStructure(raw, 'prompt')
  const paragraphById = new Map(paragraphs.map(p => [p.id, p]))

  // Sections as (start, end, label) — from doc.sections filtered to
  // canonicals.
  const sections: ResolvedSection[] = []
  for (const s of doc.sections) {
    if (s.canonical) {
      sections.push({ start: s.startOffset, end: s.endOffset, label: s.canonical })
    }
  }

  // Duplicate clusters as sets of paragraph spans.
  const clusterSpans: Array<Array<[number, number]>> = clusters.map(c =>
    c.paragraphIds
      .map(id => paragraphById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map(p => [p.startOffset, p.endOffset] as [number, number]),
  )

  return { sections, clusterSpans, report }
}

// --------- CLI ---------

function parseArgs(argv: string[]): { promptFilter?: string; json: boolean } {
  const out: { promptFilter?: string; json: boolean } = { json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--prompt' && argv[i + 1]) {
      out.promptFilter = argv[++i]
    } else if (argv[i] === '--json') {
      out.json = true
    }
  }
  return out
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + '%'
}

function printReport(results: EvalResult[]) {
  const line = '─'.repeat(78)
  console.log(line)
  console.log('V1 pipeline eval — corpus baseline')
  console.log(line)
  for (const r of results) {
    console.log(`\n▸ ${r.promptId}  [${r.source}]`)
    console.log(`  Sections    P=${pct(r.sections.precision).padStart(7)}  R=${pct(r.sections.recall).padStart(7)}   ` +
      `(${r.sections.correct} correct / ${r.sections.predicted} predicted / ${r.sections.expected} expected)`)
    console.log(`  Duplicates  P=${pct(r.duplicates.precision).padStart(7)}  R=${pct(r.duplicates.recall).padStart(7)}   ` +
      `(${r.duplicates.correct} correct / ${r.duplicates.predicted} predicted / ${r.duplicates.expected} expected)`)
    if (r.relatedFalsePositives.total > 0) {
      const fp = r.relatedFalsePositives
      const rate = fp.total > 0 ? fp.falsePositives / fp.total : 0
      console.log(`  Related→Dup FP  ${fp.falsePositives}/${fp.total}  (${pct(rate)} of related-not-dup cases mis-labelled)`)
    }
  }
  console.log('\n' + line)
  const totalSec = results.reduce((a, r) => a + r.sections.expected, 0)
  const corrSec = results.reduce((a, r) => a + r.sections.correct, 0)
  const predSec = results.reduce((a, r) => a + r.sections.predicted, 0)
  const totalDup = results.reduce((a, r) => a + r.duplicates.expected, 0)
  const corrDup = results.reduce((a, r) => a + r.duplicates.correct, 0)
  const predDup = results.reduce((a, r) => a + r.duplicates.predicted, 0)
  const totalRel = results.reduce((a, r) => a + r.relatedFalsePositives.total, 0)
  const fpRel = results.reduce((a, r) => a + r.relatedFalsePositives.falsePositives, 0)
  console.log('AGGREGATE')
  console.log(`  Sections    P=${pct(predSec ? corrSec / predSec : 1)}  R=${pct(totalSec ? corrSec / totalSec : 1)}`)
  console.log(`  Duplicates  P=${pct(predDup ? corrDup / predDup : 1)}  R=${pct(totalDup ? corrDup / totalDup : 1)}`)
  console.log(`  Related→Dup FP rate  ${fpRel}/${totalRel}  (${pct(totalRel ? fpRel / totalRel : 0)})`)
  console.log(line)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const corpus = loadCorpus()
  const filtered = args.promptFilter
    ? corpus.filter(p => p.id === args.promptFilter)
    : corpus
  if (filtered.length === 0) {
    console.error(`No prompts matched filter ${args.promptFilter ?? '(none)'}`)
    process.exit(1)
  }
  const results: EvalResult[] = []
  for (const p of filtered) {
    const v1 = runV1(p.raw)
    results.push({
      promptId: p.id,
      source: p.source,
      sections: scoreSections(p.sections as ResolvedSection[], v1.sections),
      duplicates: scoreDuplicates(p.duplicates, v1.clusterSpans),
      relatedFalsePositives: countRelatedFalsePositives(p.relatedNotDuplicate, v1.clusterSpans),
    })
  }
  if (args.json) {
    console.log(JSON.stringify({ results }, null, 2))
  } else {
    printReport(results)
  }
}

main()
