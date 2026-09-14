import { parseTree, findNodeAtLocation, type Node } from 'jsonc-parser'
import type { ParsedDoc, Section } from './types'

export interface ToolParam {
  name: string
  description: string
  type: string | null
  descOffset: number
  descEnd: number
  nameOffset: number
  nameEnd: number
}

export interface ParsedTool extends ParsedDoc {
  toolName: string | null
  toolNameRange: [number, number] | null
  toolDescription: string | null
  toolDescriptionRange: [number, number] | null
  params: ToolParam[]
}

function nodeString(n: Node | undefined): string | null {
  if (!n || n.type !== 'string') return null
  return typeof n.value === 'string' ? n.value : null
}

function nodeStringRange(n: Node | undefined): [number, number] | null {
  if (!n || n.type !== 'string') return null
  return [n.offset + 1, n.offset + n.length - 1]
}

export function parseToolDocument(raw: string): ParsedTool {
  const sections: Section[] = []
  const root = parseTree(raw)
  const params: ToolParam[] = []

  let toolName: string | null = null
  let toolNameRange: [number, number] | null = null
  let toolDescription: string | null = null
  let toolDescriptionRange: [number, number] | null = null

  if (root) {
    const nameNode = findNodeAtLocation(root, ['name'])
    toolName = nodeString(nameNode)
    toolNameRange = nodeStringRange(nameNode)
    if (nameNode && toolName != null && toolNameRange) {
      sections.push({
        kind: 'xml',
        name: 'name',
        text: toolName,
        startOffset: toolNameRange[0],
        endOffset: toolNameRange[1],
      })
    }

    const descNode = findNodeAtLocation(root, ['description'])
    toolDescription = nodeString(descNode)
    toolDescriptionRange = nodeStringRange(descNode)
    if (descNode && toolDescription != null && toolDescriptionRange) {
      sections.push({
        kind: 'xml',
        name: 'description',
        text: toolDescription,
        startOffset: toolDescriptionRange[0],
        endOffset: toolDescriptionRange[1],
      })
    }

    const props = findNodeAtLocation(root, ['parameters', 'properties'])
    if (props && props.type === 'object' && props.children) {
      for (const propPair of props.children) {
        if (propPair.type !== 'property' || !propPair.children || propPair.children.length < 2) continue
        const keyNode = propPair.children[0]
        const valNode = propPair.children[1]
        const pname = nodeString(keyNode)
        const pnameRange = nodeStringRange(keyNode)
        if (!pname || !pnameRange) continue
        const pdescNode = findNodeAtLocation(valNode, ['description'])
        const ptypeNode = findNodeAtLocation(valNode, ['type'])
        const pdesc = nodeString(pdescNode) ?? ''
        const pdescRange = nodeStringRange(pdescNode) ?? [valNode.offset, valNode.offset + valNode.length]
        params.push({
          name: pname,
          description: pdesc,
          type: nodeString(ptypeNode),
          nameOffset: pnameRange[0],
          nameEnd: pnameRange[1],
          descOffset: pdescRange[0],
          descEnd: pdescRange[1],
        })
      }
    }
  }

  return {
    docType: 'tool',
    raw,
    sections,
    variables: [],
    toolName,
    toolNameRange,
    toolDescription,
    toolDescriptionRange,
    params,
  }
}
