import { lazy, Suspense, useMemo, useState } from 'react'
import {
  adviceFor,
  type CanonicalSection,
  type DuplicationCluster,
  type DuplicationEdge,
  type NoiseFlag,
  type NoiseKind,
  type Paragraph,
  type StructureReport,
} from '@richprompt/core'

// Lazy — pulls d3-force + the graph module in a chunk only on first render.
const DuplicationGraph = lazy(() =>
  import('./DuplicationGraph').then(m => ({ default: m.DuplicationGraph })),
)

import type {
  ContradictionFinding,
  SemanticState,
  VerifiedExtraction,
} from '../hooks/useSemanticDuplication'

interface Props {
  report: StructureReport
  onJump: (offset: number) => void
  dismissed: Set<string>
  onToggleDismiss: (id: string) => void
  onClearDismissals: () => void
  /** Current live source char count — for the stale banner. */
  liveChars: number
  loading: boolean
  stale: boolean
  manualMode: boolean
  lastDurationMs: number
  onReanalyze: () => void
  /** Semantic (embeddings) duplication state + controls. */
  semantic: SemanticState
  onActivateSemantic: () => void | Promise<void>
  onDeactivateSemantic: () => void
  /** Is the sidecar's OpenAI path available? */
  openaiReady: boolean
  openaiReason: string | null
}

const SECTION_COLORS: Record<CanonicalSection, string> = {
  role:        '#4a8fd6',
  task:        '#5ab671',
  output:      '#9a6ad9',
  constraints: '#d69a3a',
}
const OTHER_COLOR = '#555'

export function StructurePanel({
  report,
  onJump,
  dismissed,
  onToggleDismiss,
  onClearDismissals,
  liveChars,
  loading,
  stale,
  manualMode,
  lastDurationMs,
  onReanalyze,
  semantic,
  onActivateSemantic,
  onDeactivateSemantic,
  openaiReady,
  openaiReason,
}: Props) {
  const {
    budget, sections, chars, approxTokens,
    duplicationClusters, duplicationEdges, noise, paragraphs,
  } = report
  // When semantic mode is active AND we have a successful analysis, use
  // it in place of the trigram data. Otherwise trigram wins.
  const usingSemantic = semantic.active && semantic.analysis !== null
  const activeClusters = usingSemantic ? semantic.analysis!.clusters : duplicationClusters
  const activeEdges = usingSemantic ? semantic.analysis!.edges : duplicationEdges
  const paragraphById = useMemo(() => {
    const m = new Map<string, Paragraph>()
    for (const p of paragraphs) m.set(p.id, p)
    return m
  }, [paragraphs])

  const activeDups = activeClusters.filter(c => !dismissed.has(c.id))
  const activeNoise = noise.filter(n => !dismissed.has(n.id))
  const dismissedCount =
    activeClusters.filter(c => dismissed.has(c.id)).length +
    noise.filter(n => dismissed.has(n.id)).length

  return (
    <div className="structure-panel">
      <StatusStrip
        loading={loading}
        stale={stale}
        manualMode={manualMode}
        liveChars={liveChars}
        computedChars={chars}
        lastDurationMs={lastDurationMs}
        onReanalyze={onReanalyze}
      />
      <BudgetBar budget={budget} chars={chars} approxTokens={approxTokens} />
      <SectionStack sections={sections} totalChars={chars} onJump={onJump} />
      <SectionList sections={sections} onJump={onJump} />
      {usingSemantic && semantic.verified && semantic.contradictions.length > 0 && (
        <ContradictionList
          items={semantic.contradictions}
          onJump={onJump}
        />
      )}
      {usingSemantic && semantic.verifiedExtractions.length > 0 && (
        <ExtractionList
          items={semantic.verifiedExtractions}
          onJump={onJump}
        />
      )}
      <DuplicationSection
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
      />
      <NoiseList
        flags={activeNoise}
        onJump={onJump}
        onDismiss={onToggleDismiss}
      />
      {dismissedCount > 0 && (
        <div className="dismissed-footer">
          {dismissedCount} finding{dismissedCount === 1 ? '' : 's'} dismissed for this doc version.{' '}
          <button className="link-btn" onClick={onClearDismissals}>Restore all</button>
        </div>
      )}
    </div>
  )
}

function BudgetBar({
  budget,
  chars,
  approxTokens,
}: {
  budget: StructureReport['budget']
  chars: number
  approxTokens: number
}) {
  const capped = Math.min(200, budget.percentUsed)
  return (
    <div className="budget-bar-wrap">
      <div className="budget-line">
        <span className="budget-nums">
          <strong>{chars.toLocaleString()}</strong> chars
          <span className="dim"> · </span>
          <strong>~{approxTokens.toLocaleString()}</strong> tokens
          <span className="dim"> · </span>
          <span title="Approximation (chars / 4). Real tokenization may differ up to 40% for code/JSON-heavy text.">
            <strong>{budget.percentUsed}%</strong> of {budget.model} practical budget
          </span>
        </span>
        <span className={`budget-tone tone-${budget.tone}`}>{toneLabel(budget.tone)}</span>
      </div>
      <div className="budget-track">
        <div className={`budget-fill tone-${budget.tone}`} style={{ width: `${capped / 2}%` }} />
        <div className="budget-marker" style={{ left: '50%' }} title="100% = practical budget" />
      </div>
      <div className="budget-context dim">
        Context window: {budget.contextWindow.toLocaleString()} tokens · practical:{' '}
        {budget.practicalTokens.toLocaleString()}
      </div>
    </div>
  )
}

function toneLabel(t: 'good' | 'ok' | 'bad'): string {
  if (t === 'good') return 'comfortable'
  if (t === 'ok')   return 'over budget'
  return 'far over budget'
}

function SectionStack({
  sections,
  totalChars,
  onJump,
}: {
  sections: StructureReport['sections']
  totalChars: number
  onJump: (offset: number) => void
}) {
  if (totalChars === 0 || sections.length === 0) return null
  const uncounted = totalChars - sections.reduce((a, s) => a + s.chars, 0)
  return (
    <div className="section-stack">
      <div className="section-stack-title">Section proportions</div>
      <div className="section-stack-bar">
        {sections.map(s => (
          <button
            key={`${s.canonical ?? 'other'}-${s.heading ?? ''}-${s.startOffset}`}
            className="section-seg"
            style={{
              flexBasis: `${s.fraction * 100}%`,
              background: colorFor(s.canonical),
            }}
            title={`${labelFor(s)} — ${s.chars.toLocaleString()} chars (${Math.round(s.fraction * 100)}%)`}
            onClick={() => onJump(s.startOffset)}
          />
        ))}
        {uncounted > 0 && (
          <div
            className="section-seg gap"
            style={{ flexBasis: `${(uncounted / totalChars) * 100}%` }}
            title={`${uncounted.toLocaleString()} chars outside detected sections`}
          />
        )}
      </div>
      <Legend sections={sections} />
    </div>
  )
}

function Legend({ sections }: { sections: StructureReport['sections'] }) {
  const canonicals = Array.from(
    new Set(sections.map(s => s.canonical).filter((c): c is CanonicalSection => !!c)),
  )
  const hasOther = sections.some(s => !s.canonical)
  return (
    <div className="section-legend">
      {canonicals.map(c => (
        <span key={c} className="legend-dot" style={{ background: SECTION_COLORS[c] }}>
          <span className="legend-label">{c}</span>
        </span>
      ))}
      {hasOther && (
        <span className="legend-dot" style={{ background: OTHER_COLOR }}>
          <span className="legend-label">other</span>
        </span>
      )}
    </div>
  )
}

function SectionList({
  sections,
  onJump,
}: {
  sections: StructureReport['sections']
  onJump: (offset: number) => void
}) {
  if (sections.length === 0) {
    return <div className="section-empty">No headings or XML sections detected — the whole prompt is one flat block.</div>
  }
  const largest = sections.reduce((a, s) => s.chars > a.chars ? s : a, sections[0])
  return (
    <div className="section-list">
      <div className="section-list-title">Sections ({sections.length})</div>
      <table className="section-table">
        <thead>
          <tr>
            <th></th>
            <th>section</th>
            <th>chars</th>
            <th>~tokens</th>
            <th>share</th>
            <th>¶</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s, i) => (
            <tr
              key={i}
              className={s === largest ? 'largest' : ''}
              onClick={() => onJump(s.startOffset)}
            >
              <td>
                <span className="section-swatch" style={{ background: colorFor(s.canonical) }} />
              </td>
              <td>
                <span className="section-name">{labelFor(s)}</span>
                {s === largest && <span className="tag-largest">largest</span>}
              </td>
              <td className="mono">{s.chars.toLocaleString()}</td>
              <td className="mono">{s.approxTokens.toLocaleString()}</td>
              <td className="mono">{Math.round(s.fraction * 100)}%</td>
              <td className="mono">{s.paragraphCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function labelFor(s: StructureReport['sections'][number]): string {
  if (s.canonical && s.heading) return `${s.canonical} · ${s.heading}`
  if (s.canonical) return s.canonical
  if (s.heading) return s.heading
  return '(uncategorized)'
}

function colorFor(canonical: CanonicalSection | undefined): string {
  return canonical ? SECTION_COLORS[canonical] : OTHER_COLOR
}

function StatusStrip({
  loading,
  stale,
  manualMode,
  liveChars,
  computedChars,
  lastDurationMs,
  onReanalyze,
}: {
  loading: boolean
  stale: boolean
  manualMode: boolean
  liveChars: number
  computedChars: number
  lastDurationMs: number
  onReanalyze: () => void
}) {
  if (!loading && !stale && !manualMode) return null
  return (
    <div className={`structure-status ${loading ? 'busy' : stale ? 'stale' : 'idle'}`}>
      {loading && <><span className="spinner" /> <span>Analyzing…</span></>}
      {!loading && stale && (
        <>
          <span>
            Doc changed since last analysis
            {computedChars !== liveChars && (
              <span className="dim"> · was {computedChars.toLocaleString()} chars, now {liveChars.toLocaleString()}</span>
            )}
          </span>
        </>
      )}
      {!loading && !stale && manualMode && (
        <span className="dim">
          Manual mode (prompt &gt; 30k chars). Last analysis: {Math.round(lastDurationMs)}ms
        </span>
      )}
      {!loading && (stale || manualMode) && (
        <button className="rescan-btn" onClick={onReanalyze}>Re-analyze</button>
      )}
    </div>
  )
}

function DuplicationSection({
  clusters,
  edges,
  edgeLabels,
  paragraphById,
  paragraphs,
  onJump,
  onDismiss,
  semantic,
  usingSemantic,
  openaiReady,
  openaiReason,
  onActivateSemantic,
  onDeactivateSemantic,
}: {
  clusters: DuplicationCluster[]
  edges: DuplicationEdge[]
  edgeLabels: SemanticState['edgeLabels']
  paragraphById: Map<string, Paragraph>
  paragraphs: Paragraph[]
  onJump: (offset: number) => void
  onDismiss: (id: string) => void
  semantic: SemanticState
  usingSemantic: boolean
  openaiReady: boolean
  openaiReason: string | null
  onActivateSemantic: () => void | Promise<void>
  onDeactivateSemantic: () => void
}) {
  const [view, setView] = useState<'list' | 'graph'>(() => {
    try { return (localStorage.getItem('richprompt.dup.view') as 'list' | 'graph') || 'list' } catch { return 'list' }
  })
  const toggleView = (v: 'list' | 'graph') => {
    setView(v)
    try { localStorage.setItem('richprompt.dup.view', v) } catch { /* ignore */ }
  }
  const activeEdges = useMemo(() => {
    const active = new Set(clusters.map(c => c.id))
    return edges.filter(e => active.has(e.clusterId))
  }, [clusters, edges])
  const header = (
    <>
      <div className="structure-block-title">
        Duplication <span className="count">{clusters.length}</span>
        {usingSemantic && <span className="mode-chip mode-semantic">semantic</span>}
        {!usingSemantic && <span className="mode-chip mode-trigram">trigram</span>}
        <DeepAnalyzeControl
          semantic={semantic}
          usingSemantic={usingSemantic}
          openaiReady={openaiReady}
          openaiReason={openaiReason}
          onActivate={onActivateSemantic}
          onDeactivate={onDeactivateSemantic}
        />
        {clusters.length > 0 && (
          <div className="view-toggle">
            <button
              className={`vt ${view === 'list' ? 'active' : ''}`}
              onClick={() => toggleView('list')}
            >list</button>
            <button
              className={`vt ${view === 'graph' ? 'active' : ''}`}
              onClick={() => toggleView('graph')}
            >graph</button>
          </div>
        )}
      </div>
      {semantic.error && (
        <div className="semantic-error">{semantic.error}</div>
      )}
      {usingSemantic && semantic.stale && (
        <div className="semantic-stale">
          Doc changed since the last deep analysis.{' '}
          <button className="link-btn" onClick={onActivateSemantic}>Re-run</button>
        </div>
      )}
    </>
  )
  if (clusters.length === 0) {
    return (
      <div className="structure-block">
        {header}
        <div className="structure-empty">
          {usingSemantic
            ? 'No paraphrase-level duplication above the semantic threshold.'
            : 'No near-duplicate paragraphs above the trigram threshold.'}
        </div>
      </div>
    )
  }
  return (
    <div className="structure-block">
      {header}
      {view === 'graph' ? (
        <Suspense fallback={<div className="dup-graph-empty">Loading graph…</div>}>
          <DuplicationGraph
            clusters={clusters}
            edges={activeEdges}
            paragraphs={paragraphs}
            onJumpTo={onJump}
          />
        </Suspense>
      ) : (
        <DuplicationListInner
          clusters={clusters}
          edges={activeEdges}
          edgeLabels={edgeLabels}
          paragraphById={paragraphById}
          paragraphs={paragraphs}
          onJump={onJump}
          onDismiss={onDismiss}
        />
      )}
    </div>
  )
}

function ExtractionList({
  items,
  onJump,
}: {
  items: VerifiedExtraction[]
  onJump: (offset: number) => void
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copy = async (id: string, snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(prev => prev === id ? null : prev), 1500)
    } catch { /* clipboard denied */ }
  }
  return (
    <div className="structure-block">
      <div className="structure-block-title">
        Extraction candidates <span className="count">{items.length}</span>
        <span className="contra-hint">verified by LLM</span>
      </div>
      <ul className="finding-list">
        {items.map(({ candidate: x, reason }) => (
          <li key={x.id} className="finding-row">
            <div className="finding-header static">
              <span className={`finding-badge extract target-${x.target}`}>{x.target}</span>
              <span className="finding-message">
                <strong>{reason || x.reason}</strong>
              </span>
              <span className="finding-actions">
                <button className="link-btn" onClick={() => onJump(x.range.startOffset)}>jump</button>
                <button
                  className="link-btn"
                  onClick={() => copy(x.id, x.extractedSnippet)}
                  title="Copy the extracted target snippet to clipboard"
                >
                  {copiedId === x.id ? 'copied ✓' : 'copy'}
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ContradictionList({
  items,
  onJump,
}: {
  items: ContradictionFinding[]
  onJump: (offset: number) => void
}) {
  return (
    <div className="structure-block">
      <div className="structure-block-title">
        Contradictions <span className="count">{items.length}</span>
        <span className="contra-hint">verified by LLM</span>
      </div>
      <ul className="finding-list">
        {items.map(c => (
          <li key={c.id} className="finding-row">
            <div className="finding-header static">
              <span className="finding-badge contra">contradiction</span>
              <span className="finding-similarity">{Math.round(c.similarity * 100)}%</span>
              <span className="finding-message">
                <strong>{c.reason || 'Model flagged these two paragraphs as conflicting.'}</strong>
              </span>
              <span className="finding-actions">
                <button className="link-btn" onClick={() => onJump(c.fromOffset)}>jump A</button>
                <button className="link-btn" onClick={() => onJump(c.toOffset)}>jump B</button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Roll edge-level verdicts up to a single cluster label. Any
 *  contradictory edge wins (it's the most actionable signal); otherwise
 *  a majority vote. Undefined when no edges have been verified. */
function aggregateClusterLabels(
  clusters: DuplicationCluster[],
  edges: DuplicationEdge[],
  edgeLabels: SemanticState['edgeLabels'],
): Record<string, 'duplicate' | 'contradictory' | 'related' | 'unrelated' | undefined> {
  if (Object.keys(edgeLabels).length === 0) return {}
  const out: Record<string, ReturnType<typeof aggregateClusterLabels>[string]> = {}
  for (const c of clusters) {
    const clusterEdges = edges.filter(e => e.clusterId === c.id)
    const key = (e: DuplicationEdge) => e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`
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
    out[c.id] = best as ReturnType<typeof aggregateClusterLabels>[string]
  }
  return out
}

function DeepAnalyzeControl({
  semantic,
  usingSemantic,
  openaiReady,
  openaiReason,
  onActivate,
  onDeactivate,
}: {
  semantic: SemanticState
  usingSemantic: boolean
  openaiReady: boolean
  openaiReason: string | null
  onActivate: () => void | Promise<void>
  onDeactivate: () => void
}) {
  const label = semantic.loading
    ? semantic.phase === 'verifying'
      ? 'Verifying…'
      : semantic.phase === 'embedding'
      ? 'Embedding…'
      : 'Analyzing…'
    : usingSemantic
    ? 'Back to trigram'
    : 'Deep analyze'
  const onClick = () => {
    if (semantic.loading) return
    if (usingSemantic) onDeactivate()
    else void onActivate()
  }
  const disabled = !usingSemantic && !openaiReady && !semantic.loading
  const title = disabled
    ? (openaiReason ?? 'OpenAI embeddings unavailable — set OPENAI_API_KEY on the sidecar')
    : usingSemantic
    ? 'Return to fast trigram-based duplication'
    : 'Run OpenAI embeddings for paraphrase-level duplication detection'
  return (
    <button
      className={`deep-btn ${usingSemantic ? 'active' : ''} ${semantic.loading ? 'loading' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {semantic.loading && <span className="spinner" />}
      {label}
      {usingSemantic && !semantic.loading && (
        <span className="deep-meta">
          {' '}· {semantic.lastFetchedCount + semantic.lastCachedCount} ¶
          {semantic.lastCachedCount > 0 && ` (${semantic.lastCachedCount} cached)`}
          {semantic.verified && ' · verified'}
          {' · '}
          {Math.round(semantic.lastDurationMs)}ms
        </span>
      )}
    </button>
  )
}

function DuplicationListInner({
  clusters,
  edges,
  edgeLabels,
  paragraphById,
  paragraphs,
  onJump,
  onDismiss,
}: {
  clusters: DuplicationCluster[]
  edges: DuplicationEdge[]
  edgeLabels: SemanticState['edgeLabels']
  paragraphById: Map<string, Paragraph>
  paragraphs: Paragraph[]
  onJump: (offset: number) => void
  onDismiss: (id: string) => void
}) {
  const clusterVerdicts = useMemo(() => aggregateClusterLabels(clusters, edges, edgeLabels), [clusters, edges, edgeLabels])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  return (
    <ul className="finding-list">
        {clusters.map(c => {
          const open = expanded.has(c.id)
          const members = c.paragraphIds
            .map(id => paragraphById.get(id))
            .filter((p): p is Paragraph => !!p)
          return (
            <li key={c.id} className="finding-row">
              <button
                className="finding-header"
                onClick={() => toggle(c.id)}
                aria-expanded={open}
              >
                <span className={`chev ${open ? 'open' : ''}`}>▸</span>
                <span className="finding-badge dup">{c.paragraphIds.length}×</span>
                <span className="finding-similarity">{Math.round(c.similarity * 100)}%</span>
                {clusterVerdicts[c.id] && (
                  <span className={`verdict-chip v-${clusterVerdicts[c.id]}`}>
                    {clusterVerdicts[c.id]}
                  </span>
                )}
                <span className="finding-message">{adviceFor(c, paragraphs)}</span>
                <span className="finding-actions" onClick={e => e.stopPropagation()}>
                  <button
                    className="link-btn"
                    onClick={() => onJump(members[0].startOffset)}
                  >
                    jump
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => onDismiss(c.id)}
                    title="Hide this cluster for the current doc version"
                  >
                    dismiss
                  </button>
                </span>
              </button>
              <SharedContent cluster={c} />
              {open && (
                <ul className="finding-members">
                  {members.map(p => (
                    <li key={p.id}>
                      <button
                        className="member-btn"
                        onClick={() => onJump(p.startOffset)}
                      >
                        <span className="member-loc">@{p.startOffset}</span>
                        {p.section && <span className={`member-sec sb-${p.section}`}>{p.section}</span>}
                        <span className="member-text">
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
  )
}

function SharedContent({ cluster }: { cluster: DuplicationCluster }) {
  const { sharedText, sharedNgrams } = cluster
  if (!sharedText && sharedNgrams.length === 0) return null
  return (
    <div className="shared-content">
      {sharedText ? (
        <blockquote className="shared-lcs" title={`Longest common substring — ${sharedText.length} chars`}>
          “{sharedText}”
        </blockquote>
      ) : (
        <div className="shared-phrases">
          <span className="shared-label">Shared phrases:</span>
          {sharedNgrams.map((g, i) => (
            <span key={i} className="shared-chip">{g}</span>
          ))}
        </div>
      )}
    </div>
  )
}

const NOISE_LABELS: Record<NoiseKind, string> = {
  'html-comment':    'HTML comment',
  'author-marker':   'author marker',
  'placeholder':     'placeholder',
  'empty-xml-tag':   'empty tag',
  'blank-run':       'blank run',
  'boilerplate-tail':'boilerplate',
}

function NoiseList({
  flags,
  onJump,
  onDismiss,
}: {
  flags: NoiseFlag[]
  onJump: (offset: number) => void
  onDismiss: (id: string) => void
}) {
  if (flags.length === 0) {
    return (
      <div className="structure-block">
        <div className="structure-block-title">Noise</div>
        <div className="structure-empty">No noise flags — nice and tidy.</div>
      </div>
    )
  }
  return (
    <div className="structure-block">
      <div className="structure-block-title">
        Noise <span className="count">{flags.length}</span>
      </div>
      <ul className="finding-list">
        {flags.map(f => (
          <li key={f.id} className="finding-row">
            <div className="finding-header static">
              <span className={`finding-badge noise noise-${f.kind}`}>{NOISE_LABELS[f.kind]}</span>
              <span className="finding-message">
                <strong>{f.message}</strong>
                <span className="finding-hint"> · {f.suggestion}</span>
              </span>
              <span className="finding-actions">
                <button
                  className="link-btn"
                  onClick={() => onJump(f.range.startOffset)}
                >
                  jump
                </button>
                <button
                  className="link-btn"
                  onClick={() => onDismiss(f.id)}
                >
                  dismiss
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
