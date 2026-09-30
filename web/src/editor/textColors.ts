import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { textColorAttrs, textColorValue } from '../schema/colors'
import { commitSelectionChange, selectionContent } from './selectionContent'

export function selectedTextColor(e: Editor, background = false) {
  const type = e.schema.marks[background ? 'highlight' : 'textColor']!
  const read = (marks: readonly import('@tiptap/pm/model').Mark[]) => {
    const mark = type.isInSet(marks)
    return mark ? background ? mark.attrs.color ?? '#fff3a3' : textColorValue(mark.attrs) : null
  }
  const ranges = selectionContent(e.state).text.filter(r => r.parent.type.allowsMarkType(type))
  const values = e.state.selection.empty ? [read(e.state.storedMarks ?? e.state.selection.$from.marks())] : ranges.map(r => read(r.node.marks))
  return { value: values[0] ?? null, mixed: values.some(v => v !== values[0]) }
}

// The combined palette can change both marks in one undo step. Disjoint cell and mixed image
// selections use their actual text ranges; images and code never receive these marks.
export function applyTextColors(e: Editor, values: { text?: string | null; highlight?: string | null }) {
  const changes = Object.entries(values).map(([key, value]) => ({
    type: e.schema.marks[key === 'text' ? 'textColor' : 'highlight']!,
    attrs: value === null ? null : key === 'text' ? textColorAttrs(value!) : { color: value === '#fff3a3' ? null : value },
  }))
  if (!e.state.selection.empty) {
    const tr = e.state.tr
    for (const r of selectionContent(e.state).text) for (const { type, attrs } of changes) {
      if (!r.parent.type.allowsMarkType(type)) continue
      if (attrs) tr.addMark(r.from, r.to, type.create(attrs))
      else tr.removeMark(r.from, r.to, type)
    }
    commitSelectionChange(e, tr)
    return
  }
  let chain = e.chain().focus().command(({ tr }) => { closeHistory(tr); return true })
  for (const { type, attrs } of changes) chain = attrs ? chain.setMark(type.name, attrs) : chain.unsetMark(type.name)
  chain.run()
  e.view.dispatch(closeHistory(e.state.tr))
}
