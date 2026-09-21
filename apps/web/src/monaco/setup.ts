// Lean Monaco bundle: markdown grammar + JSON language service only.
// Loaded once before the first Editor mounts. Skips the default
// "load every language definition" pack shipped by monaco-editor's
// full entry.

import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/languages/definitions/markdown/register'
import 'monaco-editor/language/json/monaco.contribution'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import { loader } from '@monaco-editor/react'

// Feed Monaco the workers it asks for by language label.
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  },
}

// Point @monaco-editor/react at OUR pre-imported monaco instead of
// fetching the default CDN bundle (which pulls every language).
loader.config({ monaco })

// Call loader.init() eagerly so the editor doesn't wait on first mount.
export const monacoReady = loader.init()
