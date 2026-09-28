import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { commitSelectionChange, selectionContent } from './selectionContent'

export function hasTextTools(e: Editor): boolean {
  const selection = e.state.selection
  if (selection.empty || selection instanceof NodeSelection) return false
  const content = selectionContent(e.state)
  if (content.images.length) return content.text.length > 0
  return !e.isActive('codeBlock') && !e.isActive('inlineMath') && !e.isActive('blockMath')
}

export function textMarkActive(e: Editor, name: string): boolean {
  const content = selectionContent(e.state)
  if (!content.images.length) return e.isActive(name)
  const type = e.schema.marks[name]
  const text = content.text.filter(range => type && range.parent.type.allowsMarkType(type))
  return text.length > 0 && text.every(range => type.isInSet(range.node.marks))
}

export function textStyleActive(e: Editor, level: number): boolean {
  const content = selectionContent(e.state)
  const type = level ? 'heading' : 'paragraph'
  if (!content.images.length) return e.isActive(type, level ? { level } : undefined)
  const blocks = content.text.map(range => range.parent).filter(node => ['paragraph', 'heading'].includes(node.type.name))
  return blocks.length > 0 && blocks.every(node => node.type.name === type && (!level || node.attrs.level === level))
}

// In mixed selections, inline formatting belongs to text. Preserve image marks (including
// linked images), image-only paragraphs, code blocks and the complete original selection.
export function setSelectedTextMark(e: Editor, name: string, attrs: Record<string, unknown> | null): boolean {
  const content = selectionContent(e.state)
  if (!content.images.length) return false
  const type = e.schema.marks[name]
  if (!type) return true
  const tr = e.state.tr
  for (const range of content.text) {
    if (!range.parent.type.allowsMarkType(type)) continue
    if (attrs === null) tr.removeMark(range.from, range.to, type)
    else tr.addMark(range.from, range.to, type.create(attrs))
  }
  commitSelectionChange(e, tr)
  return true
}

export function toggleSelectedTextMark(e: Editor, name: string): boolean {
  return setSelectedTextMark(e, name, textMarkActive(e, name) ? null : {})
}

export function clearSelectedTextFormatting(e: Editor): boolean {
  const content = selectionContent(e.state)
  if (!content.images.length) return false
  const tr = e.state.tr
  for (const { from, to } of content.text) tr.removeMark(from, to)
  commitSelectionChange(e, tr)
  return true
}

export function setSelectedTextStyle(e: Editor, level: number): boolean {
  const content = selectionContent(e.state)
  if (!content.images.length) return false
  const positions = new Set<number>()
  for (const { from } of content.text) {
    const $pos = e.state.doc.resolve(from)
    if (['paragraph', 'heading'].includes($pos.parent.type.name)) positions.add($pos.before())
  }
  const tr = e.state.tr
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos)!
    const type = level ? e.schema.nodes.heading : e.schema.nodes.paragraph
    tr.setBlockType(pos, pos + node.nodeSize, type, level ? { level } : undefined)
  }
  commitSelectionChange(e, tr)
  return true
}
