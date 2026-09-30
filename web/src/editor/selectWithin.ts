import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

const containers = new Set(['codeBlock', 'tableCell', 'tableHeader', 'callout', 'foldBlock', 'highlightBlock'])

// Mod-A selects the content of the code block, table cell or callout holding the cursor; pressed
// again, the one around it, and then the whole document.
export const SelectWithin = Extension.create({
  name: 'selectWithin',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      'Mod-a': ({ editor }) => {
        const { state } = editor
        const { $from, from, to } = state.selection
        for (let d = $from.depth; d > 0; d--) {
          if (!containers.has($from.node(d).type.name)) continue
          const sel = TextSelection.between(state.doc.resolve($from.start(d)), state.doc.resolve($from.end(d)))
          if (sel.from <= from && sel.to >= to && (sel.from < from || sel.to > to)) {
            editor.view.dispatch(state.tr.setSelection(sel))
            return true
          }
        }
        return false
      },
    }
  },
})
