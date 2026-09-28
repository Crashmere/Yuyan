import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

export interface SelectedNode { node: PMNode; pos: number }
export interface SelectedText { node: PMNode; parent: PMNode; from: number; to: number }
interface SelectionContent { images: SelectedNode[]; text: SelectedText[] }
const cache = new WeakMap<Selection, { doc: PMNode; content: SelectionContent }>()

// Cell selections have disjoint ranges. Never treat their outer bounds as one selection.
// Cache across toolbar-position transactions, which change neither the document nor selection.
export function selectionContent({ doc, selection }: Pick<EditorState, 'doc' | 'selection'>): SelectionContent {
  const cached = cache.get(selection)
  if (cached?.doc === doc) return cached.content
  const images = new Map<number, SelectedNode>()
  const text = new Map<number, SelectedText>()
  if (!selection.empty && (!(selection instanceof NodeSelection) || selection.node.type.name === 'image')) {
    for (const { $from, $to } of selection.ranges) {
      doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
        if (node.type.name === 'codeBlock') return false
        if (node.type.name === 'image') images.set(pos, { node, pos })
        if (node.isText && parent) text.set(pos, { node, parent, from: Math.max(pos, $from.pos), to: Math.min(pos + node.nodeSize, $to.pos) })
      })
    }
  }
  const content = { images: [...images.values()], text: [...text.values()] }
  cache.set(selection, { doc, content })
  return content
}

// Attribute and mark changes preserve positions, including backward and cell selections.
// Each toolbar batch can be undone without also undoing the preceding or following edit.
export function commitSelectionChange(e: Editor, tr: Transaction): boolean {
  if (!e.isEditable) return false
  if (!tr.docChanged) {
    e.commands.focus(undefined, { scrollIntoView: false })
    return false
  }
  tr.setSelection(e.state.selection.getBookmark().resolve(tr.doc))
  e.view.dispatch(closeHistory(tr))
  e.view.dispatch(closeHistory(e.state.tr))
  e.commands.focus(undefined, { scrollIntoView: false })
  return true
}
