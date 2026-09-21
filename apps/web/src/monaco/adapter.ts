import type { editor, IRange } from 'monaco-editor'
import type { CanonicalSection, Diagnostic, Section, Severity } from '@richprompt/core'

export const MARKER_OWNER = 'richprompt'

export const CANONICAL_COLORS: Record<CanonicalSection, string> = {
  role:        '#4a8fd6',
  task:        '#5ab671',
  output:      '#9a6ad9',
  constraints: '#d69a3a',
}

type MonacoNS = typeof import('monaco-editor')

function severityToMarker(mon: MonacoNS, s: Severity): number {
  switch (s) {
    case 'error': return mon.MarkerSeverity.Error
    case 'warn': return mon.MarkerSeverity.Warning
    case 'info': return mon.MarkerSeverity.Info
  }
}

export function offsetToRange(model: editor.ITextModel, startOffset: number, endOffset: number): IRange {
  const start = model.getPositionAt(startOffset)
  const end = model.getPositionAt(Math.max(endOffset, startOffset + 1))
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  }
}

export function sectionsToDecorations(
  model: editor.ITextModel,
  sections: Section[],
): editor.IModelDeltaDecoration[] {
  const out: editor.IModelDeltaDecoration[] = []
  for (const s of sections) {
    if (!s.canonical) continue
    const r = offsetToRange(model, s.startOffset, s.endOffset)
    out.push({
      range: r,
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `canonical-bar canonical-${s.canonical}`,
        overviewRuler: {
          color: CANONICAL_COLORS[s.canonical],
          position: 4,
        },
      },
    })
  }
  return out
}

export interface HighlightRange {
  startOffset: number
  endOffset: number
  /** 1-based index of this range within a set — surfaces in the gutter
   *  as `[1]`, `[2]`, … so cluster members stay identifiable when
   *  they're scattered across the doc. */
  index?: number
}

/** Highlight arbitrary offset ranges — used for cluster-merge preview
 *  where we want to make every member of the cluster visible at once
 *  in the editor. */
export function highlightsToDecorations(
  model: editor.ITextModel,
  ranges: HighlightRange[],
): editor.IModelDeltaDecoration[] {
  return ranges.map(r => ({
    range: offsetToRange(model, r.startOffset, r.endOffset),
    options: {
      isWholeLine: true,
      className: 'merge-highlight',
      linesDecorationsClassName: 'merge-highlight-bar',
      overviewRuler: {
        color: '#f97316',
        position: 4,
      },
    },
  }))
}

export function diagnosticsToMarkers(
  mon: MonacoNS,
  model: editor.ITextModel,
  diagnostics: Diagnostic[],
): editor.IMarkerData[] {
  return diagnostics.map(d => {
    const r = offsetToRange(model, d.range.startOffset, d.range.endOffset)
    return {
      severity: severityToMarker(mon, d.severity),
      message: d.fix ? `${d.message}\n\nFix: ${d.fix}` : d.message,
      source: d.ruleId,
      startLineNumber: r.startLineNumber,
      startColumn: r.startColumn,
      endLineNumber: r.endLineNumber,
      endColumn: r.endColumn,
    }
  })
}
