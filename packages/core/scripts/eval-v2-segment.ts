#!/usr/bin/env node
/**
 * Phase 1 eval — calls the sidecar's /v2/segment on each corpus
 * prompt and scores the combined (regex + semantic) boundary set
 * against labelled expected boundaries.
 *
 * Gate (PIPELINE_V2_PLAN.md phase 1): v2 finds more boundaries than
 * v1 with per-boundary precision ≥ 80%. If precision is below 80%,
 * we're introducing more noise than signal.
 *
 * Run:  cd packages/core && VITE_TESTRUNNER_URL=http://localhost:8787 \
 *       OPENAI_API_KEY=sk-... npx tsx scripts/eval-v2-segment.ts
 * Threshold sweep:  ... -- --thresholds 0.55,0.60,0.65,0.70,0.75
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDocument } from '../src/index'

const BASE = process.env.VITE_TESTRUNNER_URL ?? 'http://localhost:8787'
const BOUNDARY_TOLERANCE = 50 // chars

interface LabelSection {
  anchor: string
  until?: string
  label: string
}
interface PromptLabels {
  file: string
  source: string
  sections: LabelSection[]
}
interface Labels {
  version: number
  prompts: Record<string, PromptLabels>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CORPUS_DIR = join(__dirname, '..', 'src', '__tests__', 'corpus')

function resolveAnchor(raw: string, anchor: string, name: string): number {
  const idx = raw.indexOf(anchor)
  if (idx < 0) throw new Error(`[${name}] anchor not found: ${anchor.slice(0, 60)}`)
  if (raw.indexOf(anchor, idx + 1) >= 0) throw new Error(`[${name}] anchor ambiguous: ${anchor.slice(0, 60)}`)
  return idx
}

function loadCorpus() {
  const labelsRaw = readFileSync(join(CORPUS_DIR, 'labels.json'), 'utf8')
  const labels = JSON.parse(labelsRaw) as Labels
  const out: Array<{
    id: string
    source: string
    raw: string
    expectedBoundaries: number[]
  }> = []
  for (const [id, entry] of Object.entries(labels.prompts)) {
    const raw = readFileSync(join(CORPUS_DIR, entry.file), 'utf8')
    const boundaries = new Set<number>()
    for (const s of entry.sections) {
      boundaries.add(resolveAnchor(raw, s.anchor, `${id}:section`))
    }
    out.push({
      id,
      source: entry.source,
      raw,
      expectedBoundaries: Array.from(boundaries).sort((a, b) => a - b),
    })
  }
  return out
}

function v1Boundaries(raw: string): number[] {
  const doc = parseDocument(raw, 'prompt')
  const bounds = new Set<number>()
  for (const s of doc.sections) {
    if (s.kind === 'heading' || s.kind === 'xml') {
      if (s.canonical) bounds.add(s.startOffset)
    }
  }
  return Array.from(bounds).sort((a, b) => a - b)
}

async function callSegment(source: string, knownBoundaries: number[], threshold: number) {
  const res = await fetch(`${BASE}/v2/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, knownBoundaries, threshold }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(`segment ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`)
  }
  return await res.json() as { boundaries: number[] }
}

function scoreBoundaries(predicted: number[], expected: number[]) {
  const usedPred = new Set<number>()
  let correct = 0
  for (const exp of expected) {
    for (let i = 0; i < predicted.length; i++) {
      if (usedPred.has(i)) continue
      if (Math.abs(predicted[i] - exp) <= BOUNDARY_TOLERANCE) {
        correct++
        usedPred.add(i)
        break
      }
    }
  }
  return {
    precision: predicted.length === 0 ? 1 : correct / predicted.length,
    recall: expected.length === 0 ? 1 : correct / expected.length,
    expected: expected.length,
    predicted: predicted.length,
    correct,
  }
}

function pct(x: number): string { return (x * 100).toFixed(1) + '%' }

function parseArgs(argv: string[]) {
  const out: { thresholds: number[]; promptFilter?: string } = { thresholds: [0.65] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--thresholds' && argv[i + 1]) {
      out.thresholds = argv[++i].split(',').map(Number)
    } else if (argv[i] === '--prompt' && argv[i + 1]) {
      out.promptFilter = argv[++i]
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const corpus = loadCorpus()
  const filtered = args.promptFilter ? corpus.filter(p => p.id === args.promptFilter) : corpus
  if (filtered.length === 0) {
    console.error(`No prompts matched filter ${args.promptFilter ?? '(none)'}`)
    process.exit(1)
  }

  const line = '─'.repeat(78)
  console.log(line)
  console.log(`V2 semantic segmentation eval — sidecar at ${BASE}`)
  console.log(line)

  for (const threshold of args.thresholds) {
    console.log(`\n▶ Threshold ${threshold.toFixed(2)}`)
    let totExpected = 0, totPredV1 = 0, totCorrV1 = 0
    let totPredV2 = 0, totCorrV2 = 0
    for (const p of filtered) {
      const v1 = v1Boundaries(p.raw)
      let v2Extras: number[]
      try {
        const res = await callSegment(p.raw, v1, threshold)
        v2Extras = res.boundaries
      } catch (e) {
        console.log(`  ${p.id.padEnd(38)}  ERROR: ${(e as Error).message}`)
        continue
      }
      const v2Combined = Array.from(new Set([...v1, ...v2Extras])).sort((a, b) => a - b)
      const s1 = scoreBoundaries(v1, p.expectedBoundaries)
      const s2 = scoreBoundaries(v2Combined, p.expectedBoundaries)
      totExpected += p.expectedBoundaries.length
      totPredV1 += s1.predicted; totCorrV1 += s1.correct
      totPredV2 += s2.predicted; totCorrV2 += s2.correct
      const extras = v2Extras.length
      console.log(
        `  ${p.id.padEnd(38)}  ` +
        `v1 P=${pct(s1.precision).padStart(6)} R=${pct(s1.recall).padStart(6)}   ` +
        `v2 P=${pct(s2.precision).padStart(6)} R=${pct(s2.recall).padStart(6)}   ` +
        `+${extras} extras`,
      )
    }
    const v1P = totPredV1 ? totCorrV1 / totPredV1 : 1
    const v1R = totExpected ? totCorrV1 / totExpected : 1
    const v2P = totPredV2 ? totCorrV2 / totPredV2 : 1
    const v2R = totExpected ? totCorrV2 / totExpected : 1
    console.log(
      `\n  AGGREGATE t=${threshold.toFixed(2)}   ` +
      `v1 P=${pct(v1P)} R=${pct(v1R)}   v2 P=${pct(v2P)} R=${pct(v2R)}`,
    )
    console.log(`  GATE (v2 P ≥ 80% AND v2 R > v1 R): ${v2P >= 0.80 && v2R > v1R ? 'PASS' : 'FAIL'}`)
  }
  console.log(line)
}

main().catch(e => { console.error(e); process.exit(1) })
