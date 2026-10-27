import type { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { Selection, TextSelection } from '@tiptap/pm/state'
import type { CodeHost } from '../code/editor'

export function escapeSelection(editor: Editor, event: KeyboardEvent): boolean {
  if (editor.view.composing) return false
  if (cancelSelection(editor, event)) return true
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const head = target.selectionStart
    if (head === null) return false
    const from = target.value.slice(0, head).lastIndexOf('\n') + 1
    const end = target.value.indexOf('\n', head)
    target.setSelectionRange(from, end < 0 ? target.value.length : end)
    return true
  }
  const code = target instanceof Element ? target.closest<CodeHost>('.yy-code-editor-host')?.codeEditor : undefined
  if (code?.view.hasFocus) {
    const line = code.view.state.doc.lineAt(code.view.state.selection.main.head)
    code.view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true })
    return true
  }
  const { doc, selection } = editor.state
  if (!editor.view.hasFocus() || !selection.$head.parent.isTextblock) return false
  const start = selection.$head.start(), head = selection.head
  let from = start, to = selection.$head.end()
  // Automatic wrapping stays within the same line; explicit breaks bound the selection.
  selection.$head.parent.forEach((node, offset) => {
    if (node.type.name !== 'hardBreak') return
    const pos = start + offset
    if (pos < head) from = pos + node.nodeSize
    else to = Math.min(to, pos)
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, from, to)))
  return true
}

// Called before the individual editor keymaps so every kind of selection participates in
// the same double-Escape sequence. Only selection/focus changes; no blank paragraph is added.
function cancelSelection(editor: Editor, event: KeyboardEvent): boolean {
  if (editor.view.composing) return false
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart, end = target.selectionEnd
    if (start === null || end === null || start === end) return false
    target.setSelectionRange(start, start)
    return true
  }
  const code = target instanceof Element ? target.closest<CodeHost>('.yy-code-editor-host')?.codeEditor : undefined
  if (code?.view.hasFocus) {
    const { ranges } = code.view.state.selection
    if (ranges.length === 1 && ranges[0].empty) return false
    code.view.dispatch({ selection: { anchor: Math.min(...ranges.map(range => range.from)) }, scrollIntoView: true })
    return true
  }
  const { doc, selection } = editor.state
  if (selection.empty) return false
  // CellSelection starts with the active cell, which can be the last cell in the rectangle.
  const from = Math.min(...selection.ranges.map(range => range.$from.pos))
  const $from = doc.resolve(from)
  let caret: Selection | null = null
  if ($from.parent.inlineContent) caret = TextSelection.create(doc, from)
  else {
    // Enter a selected container at its first text position. For an atomic block, stay at
    // its leading boundary (or the preceding paragraph's end) instead of jumping past it.
    if ($from.nodeAfter && !$from.nodeAfter.isAtom) caret = Selection.findFrom($from, 1, true)
    if (!caret) {
      // Resolving a gap bookmark validates whether this boundary supports a gap cursor.
      const gap = new GapCursor($from).getBookmark().resolve(doc)
      caret = gap instanceof GapCursor ? gap : Selection.findFrom($from, -1, true) ?? Selection.findFrom($from, 1, true)
    }
  }
  if (!caret) return false
  editor.view.dispatch(editor.state.tr.setSelection(caret).scrollIntoView())
  editor.view.focus()
  return true
}
