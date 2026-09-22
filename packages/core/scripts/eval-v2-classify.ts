#!/usr/bin/env node
/**
 * Phase 2 eval — for each labelled section in the corpus, extract the
 * section's text and call /v2/classify. Compare returned (family,
 * label) against expected labels. Report per-family and per-leaf
 * accuracy.
 *
 * Gate (PIPELINE_V2_PLAN.md phase 2):
 *   - Family-level top-1 accuracy ≥ 80%
 *   - Leaf-label top-1 accuracy ≥ 65%
 *   Below either, the classifier isn't worth its deploy footprint
 *   and we go back to the LLM classification approach (or try NLI).
 *
 * Run:  cd packages/core && VITE_TESTRUNNER_URL=http://localhost:8787 \
 *       OPENAI_API_KEY=sk-... npx tsx scripts/eval-v2-classify.ts
 *   Filter: ... -- --prompt <id>
 *   JSON:   ... -- --json > eval-classify.json
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.VITE_TESTRUNNER_URL ?? 'http://localhost:8787'

// Which family each canonical leaf belongs to. Keep aligned with
// classify_v2.py.
const LEAF_TO_FAMILY: Record<string, string> = {
  role: 'textual',
  persona: 'textual',
  style: 'textual',
  tone: 'textual',
  task: 'textual',
  context: 'textual',
  output: 'textual',
  input: 'textual',
  constraints: 'textual',
  reasoning: 'textual',
  examples: 'textual',
  guardrails: 'textual',
  tools: 'tool',
  skills: 'skill',
  agents: 'agent',
}

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
  prompts: Record<string, PromptLabels>
}

interface ClassifyResponse {
  family: string
  label: string
  confidence: number
  alternatives: { label: string; confidence: number }[]
  ambiguous: boolean
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
    promptId: string
    sectionIndex: number
    expectedLabel: string
    expectedFamily: string
    text: string
  }> = []
  for (const [promptId, entry] of Object.entries(labels.prompts)) {
    const raw = readFileSync(join(CORPUS_DIR, entry.file), 'utf8')
    for (let i = 0; i < entry.sections.length; i++) {
      const s = entry.sections[i]
      const start = resolveAnchor(raw, s.anchor, `${promptId}:s${i}:anchor`)
      const end = s.until ? resolveAnchor(raw, s.until, `${promptId}:s${i}:until`) : raw.length
      const text = raw.slice(start, end).trim()
      if (!text) continue
      const family = LEAF_TO_FAMILY[s.label] ?? 'textual'
      out.push({
        promptId,
        sectionIndex: i,
        expectedLabel: s.label,
        expectedFamily: family,
        text,
      })
    }
  }
  return out
}

async function classify(text: string): Promise<ClassifyResponse> {
  const res = await fetch(`${BASE}/v2/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(`classify ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`)
  }
  return await res.json() as ClassifyResponse
}

function pct(x: number): string { return (x * 100).toFixed(1) + '%' }

interface Row {
  promptId: string
  sectionIndex: number
  expectedFamily: string
  expectedLabel: string
  predictedFamily: string
  predictedLabel: string
  confidence: number
  ambiguous: boolean
  familyMatch: boolean
  leafMatch: boolean
}

function parseArgs(argv: string[]) {
  const out: { promptFilter?: string; json: boolean } = { json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--prompt' && argv[i + 1]) out.promptFilter = argv[++i]
    else if (argv[i] === '--json') out.json = true
  }
  return out
}

function confusionSummary(rows: Row[]): void {
  // Which expected labels are misclassified into what? Only show
  // labels with at least one wrong pick.
  const byLabel = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (r.leafMatch) continue
    let m = byLabel.get(r.expectedLabel)
    if (!m) { m = new Map(); byLabel.set(r.expectedLabel, m) }
    m.set(r.predictedLabel, (m.get(r.predictedLabel) ?? 0) + 1)
  }
  if (byLabel.size === 0) {
    console.log('\nCONFUSIONS: none — every leaf label was correct.')
    return
  }
  console.log('\nCONFUSIONS (expected → predicted × count):')
  for (const [exp, preds] of byLabel.entries()) {
    const parts = Array.from(preds.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p}×${n}`)
      .join(', ')
    console.log(`  ${exp.padEnd(14)} → ${parts}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const corpus = loadCorpus()
  const filtered = args.promptFilter ? corpus.filter(c => c.promptId === args.promptFilter) : corpus
  if (filtered.length === 0) {
    console.error(`No sections matched filter ${args.promptFilter ?? '(none)'}`)
    process.exit(1)
  }

  const line = '─'.repeat(78)
  if (!args.json) {
    console.log(line)
    console.log(`V2 hierarchical classifier eval — ${filtered.length} sections at ${BASE}`)
    console.log(line)
  }

  const rows: Row[] = []
  for (const c of filtered) {
    let resp: ClassifyResponse
    try {
      resp = await classify(c.text)
    } catch (e) {
      if (!args.json) console.log(`  ${c.promptId}:s${c.sectionIndex}  ERROR: ${(e as Error).message}`)
      continue
    }
    const row: Row = {
      promptId: c.promptId,
      sectionIndex: c.sectionIndex,
      expectedFamily: c.expectedFamily,
      expectedLabel: c.expectedLabel,
      predictedFamily: resp.family,
      predictedLabel: resp.label,
      confidence: resp.confidence,
      ambiguous: resp.ambiguous,
      familyMatch: resp.family === c.expectedFamily,
      leafMatch: resp.label === c.expectedLabel,
    }
    rows.push(row)
    if (!args.json) {
      const mark = row.leafMatch ? '✓' : (row.familyMatch ? '~' : '✗')
      const amb = row.ambiguous ? ' [amb]' : ''
      console.log(
        `  ${mark} ${c.promptId.slice(0, 32).padEnd(32)} s${c.sectionIndex}  ` +
        `${c.expectedLabel.padEnd(12)} → ${row.predictedLabel.padEnd(12)}  ` +
        `conf=${row.confidence.toFixed(2)}${amb}`,
      )
    }
  }

  const total = rows.length
  const familyCorrect = rows.filter(r => r.familyMatch).length
  const leafCorrect = rows.filter(r => r.leafMatch).length
  const familyAcc = total ? familyCorrect / total : 0
  const leafAcc = total ? leafCorrect / total : 0
  const ambiguousCount = rows.filter(r => r.ambiguous).length

  if (args.json) {
    console.log(JSON.stringify({
      rows,
      summary: {
        total,
        familyAccuracy: familyAcc,
        leafAccuracy: leafAcc,
        ambiguousCount,
      },
    }, null, 2))
    return
  }

  console.log('\n' + line)
  console.log('AGGREGATE')
  console.log(`  Family top-1 accuracy   ${pct(familyAcc)}   (${familyCorrect} / ${total})`)
  console.log(`  Leaf   top-1 accuracy   ${pct(leafAcc)}   (${leafCorrect} / ${total})`)
  console.log(`  Ambiguous cases         ${ambiguousCount} / ${total}`)
  console.log(line)
  console.log(`GATE (family ≥ 80% AND leaf ≥ 65%): ${familyAcc >= 0.80 && leafAcc >= 0.65 ? 'PASS' : 'FAIL'}`)
  confusionSummary(rows)
  console.log(line)
}

main().catch(e => { console.error(e); process.exit(1) })
