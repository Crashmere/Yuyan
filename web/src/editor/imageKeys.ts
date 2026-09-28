import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Command } from '@tiptap/pm/state'
import { alignment } from '../schema/alignment'

function alignedImage(node: PMNode | null | undefined): boolean {
  return node?.type.name === 'image' && !!alignment(node.attrs.blockAlign)
}

// Aligned images occupy a line, but stay inline in the stored Markdown-compatible schema.
// Treat their visible boundaries like a block: select before deleting, never join the image's
// paragraph into a heading (or the following heading into the image's paragraph).
export function deleteAtImage(direction: -1 | 1): Command {
  return (state, dispatch, view) => {
    const cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null
    if (!cursor || view?.composing) return false
    const backward = direction === -1
    const next = backward ? cursor.nodeBefore : cursor.nodeAfter
    if (alignedImage(next)) {
      const pos = backward ? cursor.pos - next!.nodeSize : cursor.pos
      if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView())
      return true
    }

    const block = cursor.parent
    if (!cursor.depth || cursor.parentOffset !== (backward ? 0 : block.content.size)) return false
    const parent = cursor.node(cursor.depth - 1)
    const index = cursor.index(cursor.depth - 1)
    const siblingIndex = index + direction
    const sibling = parent.maybeChild(siblingIndex)
    const ownImage = alignedImage(backward ? block.firstChild : block.lastChild)
    const siblingImage = sibling?.isTextblock && alignedImage(backward ? sibling.lastChild : sibling.firstChild)
    if (!ownImage && !siblingImage) return false
    const blockPos = cursor.before()
    const siblingPos = backward ? blockPos - (sibling?.nodeSize ?? 0) : cursor.after()
    const tr = state.tr

    if (ownImage) {
      // A real empty neighboring paragraph can be removed without joining the image or heading.
      if (sibling?.type.name === 'paragraph' && !sibling.content.size && parent.canReplace(siblingIndex, siblingIndex + 1)) {
        tr.delete(siblingPos, siblingPos + sibling.nodeSize)
        tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(cursor.pos)))
      } else if (sibling?.isTextblock) {
        tr.setSelection(TextSelection.create(tr.doc, siblingPos + 1 + (backward ? sibling.content.size : 0)))
      }
    } else {
      const imagePos = siblingPos + 1 + (backward ? sibling!.content.size - sibling!.lastChild!.nodeSize : 0)
      if (block.type.name === 'paragraph' && !block.content.size && parent.canReplace(index, index + 1)) {
        tr.delete(blockPos, blockPos + block.nodeSize)
      }
      tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(imagePos)))
    }
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

export const ImageKeys = Extension.create({
  name: 'imageKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const run = (direction: -1 | 1) => deleteAtImage(direction)(this.editor.state, this.editor.view.dispatch, this.editor.view)
    return { Backspace: () => run(-1), Delete: () => run(1) }
  },
})
