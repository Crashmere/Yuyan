import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import type { Mapping } from '@tiptap/pm/transform'
import { captureBlockPosition, type ReadingPosition } from '../app/content/readingPosition'
import { codeEditorIn } from '../code/editor'
import { revealHeadingAt } from './headingFolds'

export function captureEditingPosition(editor: Editor, original?: { doc: Node; mapping: Mapping }): ReadingPosition | undefined {
  const blocks: (Element | null)[] = []
  const offsets: number[] = []
  editor.state.doc.forEach((_node, offset) => {
    const dom = editor.view.nodeDOM(offset)
    blocks.push(dom instanceof Element ? dom : null)
    offsets.push(offset)
  })
  const top = (document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0) + 16
  const position = captureBlockPosition(blocks, top)
  if (position && original) {
    // Cancelling restores the original document. Undo the positional effects of inserted/deleted
    // blocks too; a removed new block lands at the nearest surviving position in that document.
    const mapped = original.mapping.map(offsets[position.block])
    position.block = Math.min(original.doc.resolve(mapped).index(0), original.doc.childCount - 1)
  }
  return position
}

export function restoreReadingPosition(editor: Editor, position: ReadingPosition): boolean {
  let pos: number | undefined
  editor.state.doc.forEach((_node, offset, index) => {
    if (index === position.block) pos = offset
  })
  if (pos === undefined) return false
  revealHeadingAt(editor.view, pos)
  const block = editor.view.nodeDOM(pos)
  if (!(block instanceof HTMLElement) || !block.isConnected) return false

  // Reading and editing have different headers and may have different heights before this block
  // (notably folded sections and code). Keep the offset inside the block, not the page's scrollY.
  const top = (document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0) + 16
  const rect = block.getBoundingClientRect()
  window.scrollBy({ top: rect.top + Math.min(position.offset, rect.height - 1) - top, behavior: 'instant' })
  const visible = block.getBoundingClientRect()
  const code = editor.state.doc.nodeAt(pos)?.type.name === 'codeBlock' ? codeEditorIn(block) : undefined
  if (code) {
    const at = code.view.posAtCoords({ x: code.view.contentDOM.getBoundingClientRect().left + 8, y: Math.max(top, visible.top) + 8 }, false) ?? 0
    editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos + 1 + at))))
    code.setSelection(at, at, true)
    return true
  }
  const caret = editor.view.posAtCoords({ left: visible.left + 8, top: Math.max(top, visible.top) + 8 })
  // Focusing the old selection at the start would undo the restored scroll, and typing should
  // start in the visible content. Atom nodes can fall back to the start of this block.
  editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(caret?.pos ?? pos))))
  editor.commands.focus(null, { scrollIntoView: false })
  return true
}
