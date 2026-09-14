import type { editor, languages, IRange, Position, CancellationToken } from 'monaco-editor'
import type { Diagnostic } from '@richprompt/core'
import { offsetToRange, MARKER_OWNER } from './adapter'

type MonacoNS = typeof import('monaco-editor')

interface DiagnosticStore {
  current: Diagnostic[]
}

export function installProviders(mon: MonacoNS, store: DiagnosticStore, languageId: string): () => void {
  const hover = mon.languages.registerHoverProvider(languageId, {
    provideHover(model: editor.ITextModel, position: Position) {
      const offset = model.getOffsetAt(position)
      const hit = store.current.find(
        d => offset >= d.range.startOffset && offset <= d.range.endOffset,
      )
      if (!hit) return null
      const parts = [
        `**[${hit.ruleId}]** ${hit.message}`,
        hit.fix ? `_Fix:_ ${hit.fix}` : '',
        hit.docsRef ? `_Ref:_ ${hit.docsRef}` : '',
      ].filter(Boolean)
      return {
        range: offsetToRange(model, hit.range.startOffset, hit.range.endOffset),
        contents: parts.map(value => ({ value })),
      }
    },
  })

  const codeAction = mon.languages.registerCodeActionProvider(languageId, {
    provideCodeActions(
      model: editor.ITextModel,
      _range: IRange,
      context: languages.CodeActionContext,
      _token: CancellationToken,
    ) {
      const actions: languages.CodeAction[] = []
      for (const marker of context.markers) {
        if (marker.owner !== MARKER_OWNER) continue
        const hit = store.current.find(
          d =>
            d.ruleId === marker.source &&
            offsetToRange(model, d.range.startOffset, d.range.endOffset).startLineNumber === marker.startLineNumber,
        )
        if (!hit) continue
        const edit = buildAutofix(model, hit)
        if (!edit) continue
        actions.push({
          title: edit.title,
          kind: 'quickfix',
          diagnostics: [marker],
          edit: {
            edits: [
              {
                resource: model.uri,
                textEdit: { range: edit.range, text: edit.text },
                versionId: model.getVersionId(),
              },
            ],
          },
          isPreferred: true,
        })
      }
      return { actions, dispose() {} }
    },
  })

  return () => {
    hover.dispose()
    codeAction.dispose()
  }
}

function buildAutofix(
  model: editor.ITextModel,
  d: Diagnostic,
): { title: string; range: IRange; text: string } | null {
  if (d.ruleId === 'prompt/under-specified-trigger') {
    const range = offsetToRange(model, d.range.startOffset, d.range.endOffset)
    return {
      title: `Replace with 'when <specific condition>'`,
      range,
      text: 'when <specific condition>',
    }
  }
  if (d.ruleId === 'prompt/missing-data-delimiter') {
    const raw = model.getValue()
    const varMatch = raw.match(/\{\{[^}]+\}\}/)
    if (!varMatch || varMatch.index === undefined) return null
    const start = varMatch.index
    const end = start + varMatch[0].length
    return {
      title: `Wrap ${varMatch[0]} in <input>…</input>`,
      range: offsetToRange(model, start, end),
      text: `<input>${varMatch[0]}</input>`,
    }
  }
  return null
}
