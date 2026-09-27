import type { Editor } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'

// Collapsed code blocks hide their code in the editor too, as in Yuque. When the cursor moves into
// one (arrow keys, find and replace, undo), it opens, so hidden code is never edited unseen.
export const openCollapsedCode = new Plugin({
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((tr) => tr.selectionSet)) return null
    const { $from } = state.selection
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type.name === 'codeBlock' && node.attrs.collapsed) {
        return state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, collapsed: false })
      }
    }
    return null
  },
})

// Collapses or opens the code block at pos; collapsing first moves the cursor out of it.
export function setCollapsed(editor: Editor, pos: number, collapsed: boolean) {
  editor
    .chain()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos)
      if (node?.type.name !== 'codeBlock') return false
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed })
      const end = pos + node.nodeSize
      if (collapsed && tr.selection.from < end && tr.selection.to > pos) tr.setSelection(TextSelection.near(tr.doc.resolve(end)))
      return true
    })
    .run()
}
