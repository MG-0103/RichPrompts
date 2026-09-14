import type { editor, IRange } from 'monaco-editor'
import type { Diagnostic, Severity } from '@richprompt/core'

export const MARKER_OWNER = 'richprompt'

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
