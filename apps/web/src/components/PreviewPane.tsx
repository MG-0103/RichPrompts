import { forwardRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import type { DocType } from '@richprompt/core'
import 'highlight.js/styles/github-dark.css'

type Props = {
  source: string
  docType: DocType
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
}

type ToolShape = {
  name?: unknown
  description?: unknown
  parameters?: unknown
  input_schema?: unknown
}

function ToolPreview({ source }: { source: string }) {
  const parsed = useMemo<
    | { ok: true; tool: ToolShape }
    | { ok: false; error: string }
  >(() => {
    try {
      const t = JSON.parse(source) as ToolShape
      return { ok: true, tool: t }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }, [source])

  if (!parsed.ok) {
    return (
      <div className="preview-tool">
        <div className="preview-tool-err">Invalid JSON — {parsed.error}</div>
      </div>
    )
  }

  const tool = parsed.tool
  const schema =
    (tool.parameters as Record<string, unknown> | undefined) ??
    (tool.input_schema as Record<string, unknown> | undefined)
  const props = (schema?.properties ?? {}) as Record<string, {
    type?: string; description?: string; enum?: unknown[]
  }>
  const required = new Set((schema?.required as string[] | undefined) ?? [])
  const entries = Object.entries(props)

  return (
    <div className="preview-tool">
      <div className="preview-tool-name">{String(tool.name ?? '(no name)')}</div>
      <div className="preview-tool-desc">
        {String(tool.description ?? '')}
      </div>
      {entries.length > 0 && (
        <table className="preview-tool-params">
          <thead>
            <tr><th>param</th><th>type</th><th>description</th></tr>
          </thead>
          <tbody>
            {entries.map(([key, def]) => (
              <tr key={key}>
                <td className="p-name">
                  {key}
                  {required.has(key) && <span className="p-req">*</span>}
                </td>
                <td className="p-type">
                  {def?.type ?? '?'}
                  {def?.enum && <span className="p-enum"> enum</span>}
                </td>
                <td className="p-desc">{def?.description ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export const PreviewPane = forwardRef<HTMLDivElement, Props>(function PreviewPane(
  { source, docType, onScroll },
  scrollRef,
) {
  if (docType === 'tool') {
    return (
      <div className="preview-pane">
        <div className="preview-label">tool card (as model sees it)</div>
        <div className="preview-scroll" ref={scrollRef} onScroll={onScroll}>
          <ToolPreview source={source} />
        </div>
      </div>
    )
  }
  return (
    <div className="preview-pane">
      <div className="preview-label">
        rendered {docType === 'skill' ? 'SKILL.md' : 'prompt'}
      </div>
      <div
        className="preview-md preview-scroll"
        ref={scrollRef}
        onScroll={onScroll}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        >
          {source}
        </ReactMarkdown>
      </div>
    </div>
  )
})
