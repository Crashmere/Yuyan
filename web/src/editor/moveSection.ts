import type { Editor } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { headingSections } from './sections'

export type SectionSide = 'before' | 'after'

export function sectionMove(state: EditorState, sourcePos: number, targetPos: number, side: SectionSide): Transaction | null {
  const sections = headingSections(state.doc)
  const source = sections.find(s => s.pos === sourcePos), target = sections.find(s => s.pos === targetPos)
  if (!source || !target) return null
  const at = side === 'before' ? target.pos : target.end
  if (at >= source.pos && at <= source.end) return null
  // Check the exact fragment against both parents. Do not let ProseMirror's fitting algorithm
  // lift a table, flatten a column or drop unsupported nodes to make a drag fit.
  const fragment = source.parent.content.cut(source.pos - source.parentPos - 1, source.end - source.parentPos - 1)
  const remaining = source.parent.content.cut(0, source.pos - source.parentPos - 1)
    .append(source.parent.content.cut(source.end - source.parentPos - 1))
  const replacement = source.parent.type.validContent(remaining) ? Fragment.empty : Fragment.from(state.schema.nodes.paragraph.create())
  const finalSource = source.parent.content.cut(0, source.pos - source.parentPos - 1).append(replacement)
    .append(source.parent.content.cut(source.end - source.parentPos - 1))
  if (!source.parent.type.validContent(finalSource)) return null
  const tr = state.tr.replaceWith(source.pos, source.end, replacement)
  const insertAt = tr.mapping.map(at, side === 'before' ? -1 : 1)
  const resolved = tr.doc.resolve(insertAt)
  if (!resolved.parent.canReplace(resolved.index(), resolved.index(), fragment)) return null
  tr.insert(insertAt, fragment)
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
  return tr
}

export function moveSection(editor: Editor, source: number, target: number, side: SectionSide): boolean {
  const tr = sectionMove(editor.state, source, target, side)
  if (!tr) return false
  editor.view.dispatch(closeHistory(tr))
  editor.view.dispatch(closeHistory(editor.state.tr))
  return true
}
