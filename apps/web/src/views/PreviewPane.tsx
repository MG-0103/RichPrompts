import { forwardRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { classifyCanonical, type CanonicalSection, type DocType } from '@richprompt/core'
import 'highlight.js/styles/github-dark.css'

// Only register the grammars we actually expect to see in prompts/skills.
// Everything else falls back to plain text.
const HIGHLIGHT_LANGS = {
  bash, javascript, json, markdown, python, shell, sql, typescript, xml, yaml,
} as const

const CANONICAL_STYLE: Record<CanonicalSection, string> = {
  role: 'border-sky-500/50 text-sky-600 dark:text-sky-400 bg-sky-500/10',
  task: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
  output: 'border-violet-500/50 text-violet-600 dark:text-violet-400 bg-violet-500/10',
  constraints: 'border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10',
}

function extractHeadingText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractHeadingText).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return extractHeadingText((children as { props: { children: React.ReactNode } }).props.children)
  }
  return ''
}

function renderHeading(Tag: 'h1' | 'h2' | 'h3' | 'h4', props: { children?: React.ReactNode }) {
  const text = extractHeadingText(props.children ?? '')
  const canonical = classifyCanonical(text)
  return (
    <Tag className="flex items-center gap-2">
      {canonical && (
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CANONICAL_STYLE[canonical]}`}
        >
          {canonical}
        </span>
      )}
      <span>{props.children}</span>
    </Tag>
  )
}

const MD_COMPONENTS = {
  h1: (p: { children?: React.ReactNode }) => renderHeading('h1', p),
  h2: (p: { children?: React.ReactNode }) => renderHeading('h2', p),
  h3: (p: { children?: React.ReactNode }) => renderHeading('h3', p),
  h4: (p: { children?: React.ReactNode }) => renderHeading('h4', p),
}

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
      <div className="p-4 text-sm text-destructive">Invalid JSON — {parsed.error}</div>
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
    <div className="space-y-3 p-4 text-sm">
      <div className="text-base font-semibold">{String(tool.name ?? '(no name)')}</div>
      <div className="text-muted-foreground">{String(tool.description ?? '')}</div>
      {entries.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">param</th>
              <th className="py-1.5 pr-3 font-medium">type</th>
              <th className="py-1.5 font-medium">description</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, def]) => (
              <tr key={key} className="border-b border-border/60">
                <td className="py-1.5 pr-3 font-mono">
                  {key}
                  {required.has(key) && <span className="ml-0.5 text-destructive">*</span>}
                </td>
                <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                  {def?.type ?? '?'}
                  {def?.enum && <span className="ml-1 text-[10px] uppercase">enum</span>}
                </td>
                <td className="py-1.5 text-muted-foreground">{def?.description ?? ''}</td>
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
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full min-h-0 overflow-auto"
    >
      {docType === 'tool' ? (
        <ToolPreview source={source} />
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none p-4 prose-pre:bg-muted prose-code:before:hidden prose-code:after:hidden">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[
              rehypeSanitize,
              [rehypeHighlight, { detect: true, languages: HIGHLIGHT_LANGS }],
            ]}
            components={MD_COMPONENTS}
          >
            {source}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
})
