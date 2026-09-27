import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import type { ReadingPosition } from '../app/content/readingPosition'

export function restoreReadingPosition(editor: Editor, position: ReadingPosition): boolean {
  let pos: number | undefined
  editor.state.doc.forEach((_node, offset, index) => {
    if (index === position.block) pos = offset
  })
  if (pos === undefined) return false
  const block = editor.view.nodeDOM(pos)
  if (!(block instanceof HTMLElement) || !block.isConnected) return false

  // Reading and editing have different headers and may have different heights before this block
  // (notably folded sections and code). Keep the offset inside the block, not the page's scrollY.
  const top = (document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0) + 16
  const rect = block.getBoundingClientRect()
  window.scrollBy({ top: rect.top + Math.min(position.offset, rect.height - 1) - top, behavior: 'instant' })
  const visible = block.getBoundingClientRect()
  const caret = editor.view.posAtCoords({ left: visible.left + 8, top: Math.max(top, visible.top) + 8 })
  // Focusing the old selection at the start would undo the restored scroll, and typing should
  // start in the visible content. Atom nodes can fall back to the start of this block.
  editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(caret?.pos ?? pos))))
  editor.commands.focus(null, { scrollIntoView: false })
  return true
}
