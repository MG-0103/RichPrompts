// Bundles EditorPane + Workbench + Monaco setup into one lazy chunk so
// nothing Monaco-related lands in the initial JS payload.
import '@/monaco/setup'
import type { RefObject, ReactNode } from 'react'
import type { Diagnostic, DocType, Section } from '@richprompt/core'
import { EditorPane, type EditorController } from './EditorPane'
import { Workbench } from './Workbench'
import type { RightPaneView } from '@/shell/views'

interface Props {
  source: string
  docType: DocType
  onDocTypeChange: (d: DocType) => void
  diagnostics: Diagnostic[]
  sections: Section[]
  onChange: (next: string) => void
  theme: 'light' | 'dark'
  editorRef: RefObject<EditorController | null>
  rightPane: RightPaneView
  onRightPaneChange: (v: RightPaneView) => void
  rightContent: ReactNode
  badges?: Partial<Record<RightPaneView, number>>
}

export function WorkbenchBundle({
  source,
  docType,
  onDocTypeChange,
  diagnostics,
  sections,
  onChange,
  theme,
  editorRef,
  rightPane,
  onRightPaneChange,
  rightContent,
  badges,
}: Props) {
  return (
    <Workbench
      editor={
        <EditorPane
          ref={editorRef}
          source={source}
          docType={docType}
          onDocTypeChange={onDocTypeChange}
          diagnostics={diagnostics}
          sections={sections}
          onChange={onChange}
          theme={theme}
        />
      }
      rightPane={rightPane}
      onRightPaneChange={onRightPaneChange}
      rightContent={rightContent}
      badges={badges}
    />
  )
}
