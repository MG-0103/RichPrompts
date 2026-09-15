import type { DocType } from './types'

export type VersionKind = 'auto' | 'commit'

export interface Version {
  docId: DocType
  id: string
  kind: VersionKind
  label?: string
  timestamp: number
  contentHash: number
  content: string
}
