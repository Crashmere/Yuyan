import type { Editor } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { alignment, type Alignment } from '../schema/alignment'
import { commitSelectionChange, selectionContent } from './selectionContent'

interface Target { pos: number; node: PMNode }
export interface AlignmentTarget {
  kind: 'paragraph' | 'image' | 'cell' | 'table'
  nodes: Target[]
  current: Alignment | null
}

function ancestor($pos: ResolvedPos, types: string[]): Target | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (types.includes(node.type.name)) return { pos: $pos.before(depth), node }
  }
  return null
}

function target(kind: AlignmentTarget['kind'], nodes: Target[]): AlignmentTarget | null {
  if (!nodes.length) return null
  const values = nodes.map(({ node }) => {
    const a = node.attrs
    return alignment(kind === 'paragraph' ? a.textAlign : kind === 'cell' ? a.cellAlign ?? a.align : a.blockAlign) ?? 'left'
  })
  return { kind, nodes, current: values.every((a) => a === values[0]) ? values[0] : null }
}

export function alignmentTargets(e: Editor): { content: AlignmentTarget | null; images: AlignmentTarget | null; table: AlignmentTarget | null } {
  const sel = e.state.selection
  const selected = sel instanceof NodeSelection ? { pos: sel.from, node: sel.node } : null
  const table = selected?.node.type.name === 'table' ? selected : ancestor(sel.$from, ['table'])
  const sameTable = table && (selected?.node === table.node || ancestor(sel.$to, ['table'])?.pos === table.pos)
  const tableTarget = sameTable ? target('table', [table]) : null
  if (selected?.node.type.name === 'image') return { content: target('image', [selected]), images: null, table: tableTarget }
  if (selected?.node.type.name === 'table') return { content: null, images: null, table: tableTarget }
  const content = selectionContent(e.state)
  const images = target('image', content.images)
  const nodes: Target[] = []
  if (tableTarget) {
    if (sel instanceof CellSelection) sel.forEachCell((node, pos) => nodes.push({ node, pos }))
    else if (sel.empty) {
      const cell = ancestor(sel.$from, ['tableHeader', 'tableCell'])
      if (cell) nodes.push(cell)
    } else {
      e.state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
        if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') { nodes.push({ node, pos }); return false }
      })
    }
    return { content: target('cell', nodes), images, table: tableTarget }
  }
  const seen = new Set<number>()
  const textParagraphs = new Set(images ? content.text.filter(range => range.parent.type.name === 'paragraph').map(range => e.state.doc.resolve(range.from).before()) : [])
  for (const { $from, $to } of sel.ranges) {
    e.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph') {
        if (!seen.has(pos) && (!images || textParagraphs.has(pos))) { nodes.push({ node, pos }); seen.add(pos) }
        return false
      }
      // Table content has its own controls; never change it as a side effect of a body selection.
      if (node.type.name === 'table') return false
    })
  }
  return { content: target('paragraph', nodes), images, table: null }
}

export function setAlignment(e: Editor, kind: AlignmentTarget['kind'] | 'selection', value: Alignment) {
  const targets = alignmentTargets(e)
  const selected = (kind === 'selection' ? [targets.content, targets.images] : [targets.content, targets.images, targets.table].filter(t => t?.kind === kind)).filter((t): t is AlignmentTarget => !!t)
  const tr = e.state.tr
  for (const t of selected) {
    const attr = t.kind === 'paragraph' ? 'textAlign' : t.kind === 'cell' ? 'cellAlign' : 'blockAlign'
    for (const { node, pos } of t.nodes) {
      if (node.attrs[attr] !== value) tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value })
      // A cell-level action applies to all its paragraphs, including previously aligned ones.
      if (t.kind === 'cell') node.descendants((child, at) => {
        if (child.type.name === 'paragraph' && child.attrs.textAlign) tr.setNodeMarkup(pos + 1 + at, undefined, { ...child.attrs, textAlign: null })
      })
    }
  }
  commitSelectionChange(e, tr)
}
