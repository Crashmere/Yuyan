import { EditorSelection, type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { smallestRange, textRanges, type SelectionRange } from '../shared/selectionRange'

export function codeSelectionRanges(state: EditorState, current: SelectionRange): SelectionRange[] {
  const { doc } = state
  const line = doc.lineAt(current.from), last = doc.lineAt(current.to)
  const ranges = [{ from: line.from, to: last.to }, { from: 0, to: doc.length }]
  if (current.to <= line.to) {
    ranges.push(...textRanges(line.text, { from: current.from - line.from, to: current.to - line.from }, false)
      .map(range => ({ from: line.from + range.from, to: line.from + range.to })))
  }
  const tree = syntaxTree(state)
  let stack = tree.resolveStack(current.from, 1)
  if (current.from === current.to) {
    const before = tree.resolveStack(current.from, -1)
    if (before.node.from >= stack.node.from && before.node.to <= stack.node.to) stack = before
  }
  for (let item: typeof stack | null = stack; item; item = item.next) ranges.push(item.node)
  return ranges
}

export function expandCodeSelection(view: EditorView): boolean {
  const { state } = view, { selection } = state
  const current = { from: Math.min(...selection.ranges.map(r => r.from)), to: Math.max(...selection.ranges.map(r => r.to)) }
  const next = smallestRange(codeSelectionRanges(state, current), current)
  if (!next) return true
  const backward = selection.main.anchor > selection.main.head
  const selected = EditorSelection.single(backward ? next.to : next.from, backward ? next.from : next.to)
  if (!selected.eq(selection)) view.dispatch({ selection: selected, scrollIntoView: true, userEvent: 'select' })
  return true
}
