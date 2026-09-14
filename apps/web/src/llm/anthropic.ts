import type { Diagnostic, DocType } from '@richprompt/core'

const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-5'

const SYSTEM = `You are a senior prompt engineer reviewing a {docType} for subjective quality issues that deterministic linters miss.

Focus on: unclear intent, tone mismatch, weak few-shot examples, missing edge cases, ambiguous phrasing, better structure suggestions. Do NOT repeat structural / pattern issues already flagged by the linter.

Format: short paragraphs or a compact bulleted list. Cite exact spans in the doc where helpful. Max 250 words.`

export interface LLMReviewRequest {
  apiKey: string
  docType: DocType
  source: string
  diagnostics: Diagnostic[]
}

export async function reviewWithClaude(req: LLMReviewRequest): Promise<string> {
  const diagSummary = req.diagnostics.length
    ? req.diagnostics.map(d => `- [${d.severity}] ${d.ruleId}: ${d.message}`).join('\n')
    : '(none)'

  const userContent = `<doc_type>${req.docType}</doc_type>

<linter_findings_already_reported>
${diagSummary}
</linter_findings_already_reported>

<document>
${req.source}
</document>

Review the document above. Report only subjective concerns the linter cannot catch.`

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM.replace('{docType}', req.docType),
      messages: [{ role: 'user', content: userContent }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`)
  }
  const body = await res.json() as { content: Array<{ type: string; text?: string }> }
  return body.content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('\n')
    .trim()
}
