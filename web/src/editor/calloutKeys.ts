import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// Enter in a callout title moves into the body; Enter on an empty last line of the body leaves
// the callout, the way lists and quotes behave.
export const CalloutKeys = Extension.create({
  name: 'calloutKeys',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty) return false

        if ($from.parent.type.name === 'calloutTitle') {
          const bodyStart = $from.after() + 2 // past the title, into calloutContent's first block
          return editor.commands.command(({ tr }) => {
            tr.setSelection(TextSelection.near(tr.doc.resolve(bodyStart)))
            return true
          })
        }

        const depth = $from.depth
        if (
          depth >= 3 &&
          $from.parent.type.name === 'paragraph' &&
          $from.parent.content.size === 0 &&
          $from.node(depth - 1).type.name === 'calloutContent' &&
          $from.index(depth - 1) === $from.node(depth - 1).childCount - 1 &&
          $from.node(depth - 1).childCount > 1
        ) {
          const calloutEnd = $from.after(depth - 2)
          return editor
            .chain()
            .command(({ tr }) => {
              tr.delete($from.before(depth), $from.after(depth))
              const pos = tr.mapping.map(calloutEnd)
              tr.insert(pos, state.schema.nodes.paragraph.create())
              tr.setSelection(TextSelection.create(tr.doc, pos + 1))
              return true
            })
            .run()
        }
        return false
      },
    }
  },
})
