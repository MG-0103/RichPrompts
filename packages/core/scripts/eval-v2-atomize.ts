#!/usr/bin/env node
/**
 * Phase 3 eval — for every labelled paragraph section that carries an
 * `atoms` list, extract the section text and call /v2/atomize. Compare
 * returned atoms against expected atoms and compute F1.
 *
 * Gate (PIPELINE_V2_PLAN.md phase 3): F1 ≥ 0.75 on atom detection
 * over the corpus. Below that, atomization is the critical path
 * failure and everything downstream (per-section matching, dup
 * detection, contradictions) is compromised.
 *
 * An atom "matches" an expected atom when either:
 *   - The two texts are identical (verbatim match), OR
 *   - Their offset ranges overlap by ≥ 70% of the shorter atom.
 *
 * Run:  cd packages/core && VITE_TESTRUNNER_URL=http://localhost:8787 \
 *       OPENAI_API_KEY=sk-... npx tsx scripts/eval-v2-atomize.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.VITE_TESTRUNNER_URL ?? 'http://localhost:8787'
const OVERLAP_THRESHOLD = 0.7

interface LabelSection {
  anchor: string
  until?: string
  label: string
}
interface LabelAtom {
  text: string
  kind: string
}
interface PromptLabels {
  file: string
  sections: LabelSection[]
  atoms?: Record<string, LabelAtom[]>
}
interface Labels {
  prompts: Record<string, PromptLabels>
}

interface AtomOut {
  text: string
  kind: string
  startOffset: number
  endOffset: number
}
interface AtomizeResponse {
  atoms: AtomOut[]
  warnings: string[]
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

function loadCases() {
  const labelsRaw = readFileSync(join(CORPUS_DIR, 'labels.json'), 'utf8')
  const labels = JSON.parse(labelsRaw) as Labels
  const cases: Array<{
    promptId: string
    sectionLabel: string
    paragraph: string
    expected: LabelAtom[]
  }> = []
  for (const [promptId, entry] of Object.entries(labels.prompts)) {
    if (!entry.atoms) continue
    const raw = readFileSync(join(CORPUS_DIR, entry.file), 'utf8')
    // Build offset ranges per section label (first section with each label).
    for (const [secLabel, atoms] of Object.entries(entry.atoms)) {
      const sec = entry.sections.find(s => s.label === secLabel)
      if (!sec) {
        console.error(`[${promptId}] atoms.${secLabel} has no matching section`)
        continue
      }
      const start = resolveAnchor(raw, sec.anchor, `${promptId}:${secLabel}:anchor`)
      const end = sec.until ? resolveAnchor(raw, sec.until, `${promptId}:${secLabel}:until`) : raw.length
      const paragraph = raw.slice(start, end).trim()
      cases.push({ promptId, sectionLabel: secLabel, paragraph, expected: atoms })
    }
  }
  return cases
}

async function atomize(paragraph: string, section: string): Promise<AtomizeResponse> {
  const res = await fetch(`${BASE}/v2/atomize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paragraph, section }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(`atomize ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`)
  }
  return await res.json() as AtomizeResponse
}

/** Find where each expected atom sits in the paragraph (verbatim
 *  substring, first occurrence). Atoms whose text isn't a substring
 *  are dropped from the gold set with a warning. */
function resolveExpected(paragraph: string, expected: LabelAtom[]) {
  const out: { text: string; kind: string; start: number; end: number }[] = []
  let cursor = 0
  for (const a of expected) {
    let idx = paragraph.indexOf(a.text, cursor)
    if (idx < 0) idx = paragraph.indexOf(a.text)
    if (idx < 0) {
      console.error(`  expected atom not found in paragraph: ${a.text.slice(0, 60)}...`)
      continue
    }
    out.push({ text: a.text, kind: a.kind, start: idx, end: idx + a.text.length })
    cursor = idx + a.text.length
  }
  return out
}

/** Score predicted vs expected atoms. Matches by overlap. */
function scoreAtoms(
  predicted: AtomOut[],
  expected: { text: string; kind: string; start: number; end: number }[],
) {
  const usedPred = new Set<number>()
  let correct = 0
  for (const exp of expected) {
    const expLen = exp.end - exp.start
    for (let i = 0; i < predicted.length; i++) {
      if (usedPred.has(i)) continue
      const p = predicted[i]
      const overlapStart = Math.max(exp.start, p.startOffset)
      const overlapEnd = Math.min(exp.end, p.endOffset)
      const overlap = Math.max(0, overlapEnd - overlapStart)
      const predLen = p.endOffset - p.startOffset
      const smaller = Math.min(expLen, predLen)
      if (smaller > 0 && overlap / smaller >= OVERLAP_THRESHOLD) {
        correct++
        usedPred.add(i)
        break
      }
    }
  }
  const precision = predicted.length === 0 ? (expected.length === 0 ? 1 : 0) : correct / predicted.length
  const recall = expected.length === 0 ? 1 : correct / expected.length
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { precision, recall, f1, correct, predicted: predicted.length, expected: expected.length }
}

function pct(x: number): string { return (x * 100).toFixed(1) + '%' }

async function main() {
  const cases = loadCases()
  if (cases.length === 0) {
    console.error('No cases in labels.json have `atoms` — nothing to eval.')
    process.exit(1)
  }
  const line = '─'.repeat(78)
  console.log(line)
  console.log(`V2 atomizer eval — ${cases.length} paragraphs at ${BASE}`)
  console.log(line)

  let totExp = 0, totPred = 0, totCorrect = 0
  for (const c of cases) {
    const expected = resolveExpected(c.paragraph, c.expected)
    let predicted: AtomOut[]
    try {
      const resp = await atomize(c.paragraph, c.sectionLabel)
      predicted = resp.atoms
      if (resp.warnings.length > 0) {
        for (const w of resp.warnings) console.log(`    ⚠ ${w}`)
      }
    } catch (e) {
      console.log(`  ${c.promptId}/${c.sectionLabel}  ERROR: ${(e as Error).message}`)
      continue
    }
    const s = scoreAtoms(predicted, expected)
    totExp += s.expected; totPred += s.predicted; totCorrect += s.correct
    console.log(
      `  ${c.promptId.slice(0, 30).padEnd(30)} ${c.sectionLabel.padEnd(12)}  ` +
      `P=${pct(s.precision).padStart(6)} R=${pct(s.recall).padStart(6)} F1=${pct(s.f1).padStart(6)}  ` +
      `(${s.correct}/${s.predicted} predicted / ${s.expected} expected)`,
    )
  }
  const aggP = totPred ? totCorrect / totPred : 0
  const aggR = totExp ? totCorrect / totExp : 0
  const aggF1 = aggP + aggR === 0 ? 0 : (2 * aggP * aggR) / (aggP + aggR)

  console.log('\n' + line)
  console.log('AGGREGATE')
  console.log(`  Precision  ${pct(aggP)}`)
  console.log(`  Recall     ${pct(aggR)}`)
  console.log(`  F1         ${pct(aggF1)}`)
  console.log(line)
  console.log(`GATE (F1 ≥ 75%): ${aggF1 >= 0.75 ? 'PASS' : 'FAIL'}`)
  console.log(line)
}

main().catch(e => { console.error(e); process.exit(1) })
