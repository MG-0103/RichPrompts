import { useMemo, useState } from 'react'
import { ChevronRight, Copy, Check, RefreshCw, Sparkles, Loader2, AlertCircle } from 'lucide-react'
import {
  adviceFor,
  type CanonicalSection,
  type DuplicationCluster,
  type DuplicationEdge,
  isNoiseFixable,
  type NoiseFlag,
  type NoiseKind,
  type Paragraph,
  type StructureReport,
} from '@richprompt/core'
import type {
  ContradictionFinding,
  SemanticState,
  VerifiedExtraction,
} from '@/hooks/useSemanticDuplication'
import type { SectionClassifierState } from '@/hooks/useSectionClassifier'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props {
  report: StructureReport
  /** Live source text — used to compute line numbers for finding ranges. */
  source: string
  onJump: (offset: number) => void
  dismissed: Set<string>
  onToggleDismiss: (id: string) => void
  onClearDismissals: () => void
  onFixNoise?: (flag: NoiseFlag) => void
  sectionClassifier?: SectionClassifierState
  classifierAvailable?: boolean
  liveChars: number
  loading: boolean
  stale: boolean
  manualMode: boolean
  lastDurationMs: number
  onReanalyze: () => void
  semantic: SemanticState
  onActivateSemantic: () => void | Promise<void>
  onDeactivateSemantic: () => void
  onReanalyzeSemantic: () => void | Promise<void>
  openaiReady: boolean
  openaiReason: string | null
}

/** Build a line-index: lineStarts[i] = char offset where line i begins. */
function buildLineIndex(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

/** Binary search for the 1-indexed line containing `offset`. */
function lineOf(lineStarts: number[], offset: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

function fmtLineRange(lineStarts: number[], startOffset: number, endOffset: number): string {
  const a = lineOf(lineStarts, startOffset)
  const b = lineOf(lineStarts, Math.max(startOffset, endOffset - 1))
  return a === b ? `L${a}` : `L${a}–${b}`
}

const SECTION_HEX: Record<CanonicalSection, string> = {
  role: '#4a8fd6',
  task: '#5ab671',
  output: '#9a6ad9',
  constraints: '#d69a3a',
}
const OTHER_HEX = '#555'

function colorFor(canonical: CanonicalSection | undefined): string {
  return canonical ? SECTION_HEX[canonical] : OTHER_HEX
}

function labelFor(s: StructureReport['sections'][number]): string {
  if (s.canonical && s.heading) return `${s.canonical} · ${s.heading}`
  if (s.canonical) return s.canonical
  if (s.heading) return s.heading
  return '(uncategorized)'
}

const NOISE_LABELS: Record<NoiseKind, string> = {
  'html-comment': 'HTML comment',
  'author-marker': 'author marker',
  'placeholder': 'placeholder',
  'empty-xml-tag': 'empty tag',
  'blank-run': 'blank run',
  'boilerplate-tail': 'boilerplate',
}

export function StructureView({
  report,
  source,
  onJump,
  dismissed,
  onToggleDismiss,
  onClearDismissals,
  onFixNoise,
  sectionClassifier,
  classifierAvailable,
  liveChars,
  loading,
  stale,
  manualMode,
  lastDurationMs,
  onReanalyze,
  semantic,
  onActivateSemantic,
  onDeactivateSemantic,
  onReanalyzeSemantic,
  openaiReady,
  openaiReason,
}: Props) {
  const {
    budget, sections, chars, approxTokens,
    duplicationClusters, duplicationEdges, noise, paragraphs,
  } = report

  const usingSemantic = semantic.active && semantic.analysis !== null
  const activeClusters = usingSemantic ? semantic.analysis!.clusters : duplicationClusters
  const activeEdges = usingSemantic ? semantic.analysis!.edges : duplicationEdges
  const paragraphById = useMemo(() => {
    const m = new Map<string, Paragraph>()
    for (const p of paragraphs) m.set(p.id, p)
    return m
  }, [paragraphs])
  const lineStarts = useMemo(() => buildLineIndex(source), [source])
  const rangeFor = useMemo(
    () => (start: number, end: number) => fmtLineRange(lineStarts, start, end),
    [lineStarts],
  )

  const activeDups = activeClusters.filter(c => !dismissed.has(c.id))
  const activeNoise = noise.filter(n => !dismissed.has(n.id))
  const dismissedCount =
    activeClusters.filter(c => dismissed.has(c.id)).length +
    noise.filter(n => dismissed.has(n.id)).length

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <StatusStrip
        loading={loading}
        stale={stale}
        manualMode={manualMode}
        liveChars={liveChars}
        computedChars={chars}
        lastDurationMs={lastDurationMs}
        onReanalyze={onReanalyze}
      />
      <BudgetCard budget={budget} chars={chars} approxTokens={approxTokens} />
      {sectionClassifier && (
        <SectionClassifierCard
          state={sectionClassifier}
          available={classifierAvailable ?? false}
        />
      )}
      <SectionsCard sections={sections} totalChars={chars} onJump={onJump} rangeFor={rangeFor} />
      {usingSemantic && semantic.verified && semantic.contradictions.length > 0 && (
        <ContradictionCard items={semantic.contradictions} onJump={onJump} rangeFor={rangeFor} />
      )}
      {usingSemantic && semantic.verifiedExtractions.length > 0 && (
        <ExtractionCard items={semantic.verifiedExtractions} onJump={onJump} rangeFor={rangeFor} />
      )}
      <DuplicationCard
        clusters={activeDups}
        edges={activeEdges}
        edgeLabels={usingSemantic ? semantic.edgeLabels : {}}
        paragraphById={paragraphById}
        paragraphs={paragraphs}
        onJump={onJump}
        onDismiss={onToggleDismiss}
        semantic={semantic}
        usingSemantic={usingSemantic}
        openaiReady={openaiReady}
        openaiReason={openaiReason}
        onActivateSemantic={onActivateSemantic}
        onDeactivateSemantic={onDeactivateSemantic}
        onReanalyzeSemantic={onReanalyzeSemantic}
        rangeFor={rangeFor}
      />
      <NoiseCard flags={activeNoise} onJump={onJump} onDismiss={onToggleDismiss} onFix={onFixNoise} rangeFor={rangeFor} />
      {dismissedCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {dismissedCount} finding{dismissedCount === 1 ? '' : 's'} dismissed for this doc version.
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onClearDismissals}>
            Restore all
          </Button>
        </div>
      )}
    </div>
  )
}

function StatusStrip({
  loading, stale, manualMode, liveChars, computedChars, lastDurationMs, onReanalyze,
}: {
  loading: boolean; stale: boolean; manualMode: boolean
  liveChars: number; computedChars: number; lastDurationMs: number
  onReanalyze: () => void
}) {
  if (!loading && !stale && !manualMode) return null
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
        loading && 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400',
        !loading && stale && 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        !loading && !stale && manualMode && 'border-border bg-muted/50 text-muted-foreground',
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {loading && <span>Analyzing…</span>}
      {!loading && stale && (
        <span>
          Doc changed since last analysis
          {computedChars !== liveChars && (
            <span className="ml-1 opacity-70">
              · was {computedChars.toLocaleString()} chars, now {liveChars.toLocaleString()}
            </span>
          )}
        </span>
      )}
      {!loading && !stale && manualMode && (
        <span>Manual mode (prompt &gt; 30k chars). Last analysis: {Math.round(lastDurationMs)}ms</span>
      )}
      {!loading && (stale || manualMode) && (
        <Button size="sm" variant="outline" className="ml-auto h-6 gap-1 text-xs" onClick={onReanalyze}>
          <RefreshCw className="h-3 w-3" /> Re-analyze
        </Button>
      )}
    </div>
  )
}

function toneMeta(t: 'good' | 'ok' | 'bad'): { label: string; bar: string; badge: string } {
  if (t === 'good') return { label: 'comfortable', bar: 'bg-emerald-500', badge: 'text-emerald-600 dark:text-emerald-400' }
  if (t === 'ok') return { label: 'over budget', bar: 'bg-amber-500', badge: 'text-amber-600 dark:text-amber-400' }
  return { label: 'far over budget', bar: 'bg-red-500', badge: 'text-red-600 dark:text-red-400' }
}

function BudgetCard({
  budget, chars, approxTokens,
}: { budget: StructureReport['budget']; chars: number; approxTokens: number }) {
  const capped = Math.min(200, budget.percentUsed)
  const meta = toneMeta(budget.tone)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>
          Budget
          <span className={cn('ml-auto text-xs font-medium', meta.badge)}>{meta.label}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span><span className="font-mono font-semibold">{chars.toLocaleString()}</span> <span className="text-muted-foreground">chars</span></span>
          <span className="text-muted-foreground">·</span>
          <span><span className="font-mono font-semibold">~{approxTokens.toLocaleString()}</span> <span className="text-muted-foreground">tokens</span></span>
          <span className="text-muted-foreground">·</span>
          <span title="Approximation (chars / 4). Real tokenization may differ up to 40%.">
            <span className="font-mono font-semibold">{budget.percentUsed}%</span>{' '}
            <span className="text-muted-foreground">of {budget.model} practical budget</span>
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full transition-all', meta.bar)} style={{ width: `${capped / 2}%` }} />
          <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/50" title="100% = practical budget" />
        </div>
        <div className="text-xs text-muted-foreground">
          Context window: {budget.contextWindow.toLocaleString()} tokens · practical: {budget.practicalTokens.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  )
}

function SectionsCard({
  sections, totalChars, onJump, rangeFor,
}: {
  sections: StructureReport['sections']
  totalChars: number
  onJump: (offset: number) => void
  rangeFor: (start: number, end: number) => string
}) {
  if (sections.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle>Sections</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No headings or XML sections detected — the whole prompt is one flat block.
          </div>
        </CardContent>
      </Card>
    )
  }
  const uncounted = totalChars - sections.reduce((a, s) => a + s.chars, 0)
  const largest = sections.reduce((a, s) => (s.chars > a.chars ? s : a), sections[0])
  const canonicals = Array.from(new Set(sections.map(s => s.canonical).filter((c): c is CanonicalSection => !!c)))
  const hasOther = sections.some(s => !s.canonical)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>
          Sections <Badge variant="secondary" className="ml-1">{sections.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-3 w-full overflow-hidden rounded-md border border-border">
          {sections.map(s => (
            <button
              key={`${s.canonical ?? 'other'}-${s.heading ?? ''}-${s.startOffset}`}
              style={{ flexBasis: `${s.fraction * 100}%`, background: colorFor(s.canonical) }}
              className="hover:brightness-125"
              title={`${labelFor(s)} — ${s.chars.toLocaleString()} chars (${Math.round(s.fraction * 100)}%)`}
              onClick={() => onJump(s.startOffset)}
            />
          ))}
          {uncounted > 0 && (
            <div
              className="bg-muted-foreground/20"
              style={{ flexBasis: `${(uncounted / totalChars) * 100}%` }}
              title={`${uncounted.toLocaleString()} chars outside detected sections`}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {canonicals.map(c => (
            <span key={c} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: SECTION_HEX[c] }} />
              <span className="text-muted-foreground">{c}</span>
            </span>
          ))}
          {hasOther && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: OTHER_HEX }} />
              <span className="text-muted-foreground">other</span>
            </span>
          )}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="w-4 py-1.5"></th>
              <th className="py-1.5 pr-3 font-medium">section</th>
              <th className="py-1.5 pr-3 font-medium">lines</th>
              <th className="py-1.5 pr-3 text-right font-medium">chars</th>
              <th className="py-1.5 pr-3 text-right font-medium">~tokens</th>
              <th className="py-1.5 pr-3 text-right font-medium">share</th>
              <th className="py-1.5 text-right font-medium">¶</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s, i) => (
              <tr
                key={i}
                onClick={() => onJump(s.startOffset)}
                className={cn(
                  'cursor-pointer border-b border-border/40 hover:bg-accent/40',
                  s === largest && 'bg-amber-500/5',
                )}
              >
                <td className="py-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor(s.canonical) }} />
                </td>
                <td className="py-1.5 pr-3">
                  {labelFor(s)}
                  {s === largest && <Badge variant="outline" className="ml-2 h-4 border-amber-500/40 text-[9px] text-amber-600 dark:text-amber-400">largest</Badge>}
                </td>
                <td className="py-1.5 pr-3 font-mono text-[10px] text-muted-foreground">
                  {rangeFor(s.startOffset, s.endOffset)}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono">{s.chars.toLocaleString()}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{s.approxTokens.toLocaleString()}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{Math.round(s.fraction * 100)}%</td>
                <td className="py-1.5 text-right font-mono">{s.paragraphCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function DeepAnalyzeButton({
  semantic, usingSemantic, openaiReady, openaiReason, onActivate, onDeactivate,
}: {
  semantic: SemanticState; usingSemantic: boolean
  openaiReady: boolean; openaiReason: string | null
  onActivate: () => void | Promise<void>; onDeactivate: () => void
}) {
  const label = semantic.loading
    ? semantic.phase === 'verifying' ? 'Verifying…'
      : semantic.phase === 'embedding' ? 'Embedding…' : 'Analyzing…'
    : usingSemantic ? 'Back to trigram' : 'Deep analyze'
  const disabled = !usingSemantic && !openaiReady && !semantic.loading
  const title = disabled
    ? (openaiReason ?? 'OpenAI embeddings unavailable — set OPENAI_API_KEY on the sidecar')
    : usingSemantic
      ? 'Return to fast trigram-based duplication'
      : 'Run OpenAI embeddings for paraphrase-level duplication detection'
  const onClick = () => {
    if (semantic.loading) return
    if (usingSemantic) onDeactivate()
    else void onActivate()
  }
  return (
    <Button
      variant={usingSemantic ? 'default' : 'outline'}
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {semantic.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {label}
      {usingSemantic && !semantic.loading && (
        <span className="text-[10px] opacity-70">
          · {semantic.lastFetchedCount + semantic.lastCachedCount}¶
          {semantic.verified && ' · verified'}
          {' · '}{Math.round(semantic.lastDurationMs)}ms
        </span>
      )}
    </Button>
  )
}

function aggregateClusterLabels(
  clusters: DuplicationCluster[],
  edges: DuplicationEdge[],
  edgeLabels: SemanticState['edgeLabels'],
): Record<string, 'duplicate' | 'contradictory' | 'related' | 'unrelated' | undefined> {
  if (Object.keys(edgeLabels).length === 0) return {}
  const out: Record<string, 'duplicate' | 'contradictory' | 'related' | 'unrelated' | undefined> = {}
  for (const c of clusters) {
    const clusterEdges = edges.filter(e => e.clusterId === c.id)
    const key = (e: DuplicationEdge) => (e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`)
    const labels = clusterEdges
      .map(e => edgeLabels[key(e)])
      .filter((v): v is NonNullable<typeof v> => !!v)
      .map(v => v.label)
    if (labels.length === 0) { out[c.id] = undefined; continue }
    if (labels.includes('contradictory')) { out[c.id] = 'contradictory'; continue }
    const counts: Record<string, number> = {}
    for (const l of labels) counts[l] = (counts[l] ?? 0) + 1
    let best: string | undefined
    let bestN = 0
    for (const [l, n] of Object.entries(counts)) {
      if (n > bestN) { best = l; bestN = n }
    }
    out[c.id] = best as 'duplicate' | 'contradictory' | 'related' | 'unrelated' | undefined
  }
  return out
}

const VERDICT_STYLE: Record<'duplicate' | 'contradictory' | 'related' | 'unrelated', string> = {
  duplicate: 'border-red-500/40 text-red-600 dark:text-red-400',
  contradictory: 'border-red-500/40 text-red-600 dark:text-red-400',
  related: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  unrelated: 'border-border text-muted-foreground',
}

function DuplicationCard({
  clusters, edges, edgeLabels, paragraphById, paragraphs, onJump, onDismiss,
  semantic, usingSemantic, openaiReady, openaiReason, onActivateSemantic, onDeactivateSemantic,
  onReanalyzeSemantic, rangeFor,
}: {
  clusters: DuplicationCluster[]; edges: DuplicationEdge[]
  edgeLabels: SemanticState['edgeLabels']
  paragraphById: Map<string, Paragraph>; paragraphs: Paragraph[]
  onJump: (offset: number) => void; onDismiss: (id: string) => void
  semantic: SemanticState; usingSemantic: boolean
  openaiReady: boolean; openaiReason: string | null
  onActivateSemantic: () => void | Promise<void>; onDeactivateSemantic: () => void
  onReanalyzeSemantic: () => void | Promise<void>
  rangeFor: (start: number, end: number) => string
}) {
  const activeEdges = useMemo(() => {
    const active = new Set(clusters.map(c => c.id))
    return edges.filter(e => active.has(e.clusterId))
  }, [clusters, edges])
  const verdicts = useMemo(() => aggregateClusterLabels(clusters, activeEdges, edgeLabels), [clusters, activeEdges, edgeLabels])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>
          Duplication
          <Badge variant="secondary" className="ml-1">{clusters.length}</Badge>
          <Badge variant="outline" className="text-[10px]">
            {usingSemantic ? 'semantic' : 'trigram'}
          </Badge>
          {usingSemantic && semantic.fromCache && !semantic.loading && (
            <Badge variant="outline" className="text-[10px]" title="Rehydrated from localStorage — no fresh embed/verify call this session.">
              cached
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {usingSemantic && !semantic.loading && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => void onReanalyzeSemantic()}
                title="Force a fresh embed + verify pass (bypasses the cache)."
              >
                <RefreshCw className="h-3 w-3" />
                Re-analyze
              </Button>
            )}
            <DeepAnalyzeButton
              semantic={semantic}
              usingSemantic={usingSemantic}
              openaiReady={openaiReady}
              openaiReason={openaiReason}
              onActivate={onActivateSemantic}
              onDeactivate={onDeactivateSemantic}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {semantic.error && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {semantic.error}
          </div>
        )}
        {usingSemantic && semantic.stale && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Doc changed since the last deep analysis.
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onActivateSemantic}>Re-run</Button>
          </div>
        )}
        {clusters.length === 0 ? (
          <div className="py-3 text-sm text-muted-foreground">
            {usingSemantic
              ? 'No paraphrase-level duplication above the semantic threshold.'
              : 'No near-duplicate paragraphs above the trigram threshold.'}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {clusters.map(c => {
              const open = expanded.has(c.id)
              const members = c.paragraphIds
                .map(id => paragraphById.get(id))
                .filter((p): p is Paragraph => !!p)
              const verdict = verdicts[c.id]
              const linesLabel = (() => {
                const labels = members.slice(0, 4).map(p => rangeFor(p.startOffset, p.endOffset))
                const suffix = members.length > 4 ? ` +${members.length - 4}` : ''
                return labels.join(', ') + suffix
              })()
              return (
                <li key={c.id} className="py-2">
                  <button
                    className="flex w-full items-center gap-2 text-left"
                    onClick={() => toggle(c.id)}
                    aria-expanded={open}
                  >
                    <ChevronRight
                      className={cn('h-3.5 w-3.5 shrink-0 transition-transform text-muted-foreground', open && 'rotate-90')}
                    />
                    <Badge variant="secondary" className="text-[10px]">{c.paragraphIds.length}×</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{Math.round(c.similarity * 100)}%</span>
                    <span className="font-mono text-[10px] text-muted-foreground" title="Line ranges of cluster members">
                      {linesLabel}
                    </span>
                    {verdict && (
                      <Badge variant="outline" className={cn('text-[10px]', VERDICT_STYLE[verdict])}>{verdict}</Badge>
                    )}
                    <span className="flex-1 truncate text-xs">{adviceFor(c, paragraphs)}</span>
                    <span
                      className="flex shrink-0 items-center gap-1"
                      onClick={e => e.stopPropagation()}
                    >
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onJump(members[0].startOffset)}>jump</Button>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onDismiss(c.id)} title="Hide this cluster for the current doc version">dismiss</Button>
                    </span>
                  </button>
                  <SharedContent cluster={c} />
                  {open && (
                    <ul className="mt-2 space-y-1 pl-6">
                      {members.map(p => (
                        <li key={p.id}>
                          <button
                            className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent/40"
                            onClick={() => onJump(p.startOffset)}
                          >
                            <span className="shrink-0 font-mono text-muted-foreground">
                              {rangeFor(p.startOffset, p.endOffset)}
                            </span>
                            {p.section && <Badge variant="outline" className="shrink-0 text-[9px]">{p.section}</Badge>}
                            <span className="min-w-0 truncate">
                              {p.text.trim().slice(0, 140).replace(/\n/g, ' ↩ ')}
                              {p.text.length > 140 ? '…' : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SharedContent({ cluster }: { cluster: DuplicationCluster }) {
  const { sharedText, sharedNgrams } = cluster
  if (!sharedText && sharedNgrams.length === 0) return null
  return (
    <div className="mt-1 pl-6">
      {sharedText ? (
        <blockquote
          className="border-l-2 border-primary/40 bg-muted/40 px-2 py-1 text-xs italic text-muted-foreground"
          title={`Longest common substring — ${sharedText.length} chars`}
        >
          &ldquo;{sharedText}&rdquo;
        </blockquote>
      ) : (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">Shared phrases:</span>
          {sharedNgrams.map((g, i) => (
            <span key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{g}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function ContradictionCard({
  items, onJump, rangeFor,
}: {
  items: ContradictionFinding[]
  onJump: (offset: number) => void
  rangeFor: (start: number, end: number) => string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>
          Contradictions <Badge variant="destructive" className="ml-1">{items.length}</Badge>
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">verified by LLM</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {items.map(c => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <Badge variant="destructive" className="text-[10px]">contradiction</Badge>
              <span className="font-mono text-xs text-muted-foreground">{Math.round(c.similarity * 100)}%</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {rangeFor(c.fromOffset, c.fromOffset + 1)} vs {rangeFor(c.toOffset, c.toOffset + 1)}
              </span>
              <span className="flex-1 text-xs">
                {c.reason || 'Model flagged these two paragraphs as conflicting.'}
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onJump(c.fromOffset)}>jump A</Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onJump(c.toOffset)}>jump B</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ExtractionCard({
  items, onJump, rangeFor,
}: {
  items: VerifiedExtraction[]
  onJump: (offset: number) => void
  rangeFor: (start: number, end: number) => string
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copy = async (id: string, snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 1500)
    } catch { /* clipboard denied */ }
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>
          Extraction candidates <Badge variant="secondary" className="ml-1">{items.length}</Badge>
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">verified by LLM</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {items.map(({ candidate: x, reason }) => (
            <li key={x.id} className="flex items-center gap-2 py-2">
              <Badge variant="outline" className="text-[10px]">{x.target}</Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {rangeFor(x.range.startOffset, x.range.endOffset)}
              </span>
              <span className="flex-1 text-xs">{reason || x.reason}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onJump(x.range.startOffset)}>jump</Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() => copy(x.id, x.extractedSnippet)}
              >
                {copiedId === x.id ? <><Check className="h-3 w-3" /> copied</> : <><Copy className="h-3 w-3" /> copy</>}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function NoiseCard({
  flags, onJump, onDismiss, onFix, rangeFor,
}: {
  flags: NoiseFlag[]
  onJump: (offset: number) => void
  onDismiss: (id: string) => void
  onFix?: (f: NoiseFlag) => void
  rangeFor: (start: number, end: number) => string
}) {
  if (flags.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle>Noise</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No noise flags — nice and tidy.</div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Noise <Badge variant="secondary" className="ml-1">{flags.length}</Badge></CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {flags.map(f => (
            <li key={f.id} className="flex items-center gap-2 py-2 text-xs">
              <Badge variant="outline" className="text-[10px]">{NOISE_LABELS[f.kind]}</Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {rangeFor(f.range.startOffset, f.range.endOffset)}
              </span>
              <span className="flex-1">
                <span className="font-medium">{f.message}</span>
                <span className="text-muted-foreground"> · {f.suggestion}</span>
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onJump(f.range.startOffset)}>jump</Button>
              {onFix && isNoiseFixable(f) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onFix(f)}
                  title={f.suggestion}
                >
                  fix
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onDismiss(f.id)}>dismiss</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

const CANONICAL_ORDER: CanonicalSection[] = ['role', 'task', 'output', 'constraints']

function SectionClassifierCard({
  state,
  available,
}: {
  state: SectionClassifierState
  available: boolean
}) {
  const { found, reasoning, loading, error, cached, truncatedFrom, run, clear } = state
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <span>Section Classifier</span>
          <Badge variant="secondary" className="text-[10px] uppercase">AI</Badge>
          {cached && found && (
            <Badge variant="outline" className="text-[10px]">cached</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          One LLM call over the whole doc — checks which of the four canonical
          sections are conceptually present, even without labelled headings.
          Overrides <span className="font-mono">missing-sections</span> for
          the sections it finds.
        </p>
        {!available && (
          <div className="flex items-center gap-2 text-xs text-amber-500">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Sidecar unreachable or OPENAI_API_KEY not set.</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}
        {found && truncatedFrom > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-500">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>
              Classified from the first 32,000 of {truncatedFrom.toLocaleString()} chars.
              Sections after that were not seen.
            </span>
          </div>
        )}
        {found && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {CANONICAL_ORDER.map(s => {
                const present = found.includes(s)
                return (
                  <Badge
                    key={s}
                    variant={present ? 'default' : 'outline'}
                    className={cn(
                      'text-[10px] uppercase',
                      !present && 'opacity-40',
                    )}
                  >
                    {present ? <Check className="mr-0.5 h-2.5 w-2.5" /> : null}
                    {s}
                  </Badge>
                )
              })}
            </div>
            {reasoning && (
              <p className="text-xs text-muted-foreground">{reasoning}</p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => void run()}
            disabled={loading || !available}
          >
            {loading ? (
              <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Classifying…</>
            ) : found ? (
              <><Sparkles className="mr-1 h-3 w-3" /> Re-run</>
            ) : (
              <><Sparkles className="mr-1 h-3 w-3" /> Verify sections with AI</>
            )}
          </Button>
          {found && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={clear}
              disabled={loading}
            >
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
