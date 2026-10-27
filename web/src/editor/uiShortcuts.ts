import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { placeCaret } from './readingPosition'

// Shortcuts that open the editor's panels, plus the Yuque shortcuts Tiptap binds differently or
// not at all. Cmd/Ctrl+K is left to the page, where it opens the search panel.
export const UiShortcuts = Extension.create<{ openFind: () => void }>({
  name: 'uiShortcuts',

  addOptions() {
    return { openFind: () => {} }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this, { state } = editor
        const cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null
        if (!cursor || cursor.pos !== 1 || cursor.parent.type.name !== 'paragraph' || cursor.parent.content.size || state.doc.childCount < 2 || editor.view.composing) return false
        editor.view.dispatch(state.tr.delete(0, cursor.after()).scrollIntoView())
        placeCaret(editor, 0)
        return true
      },
      'Mod-f': () => {
        this.options.openFind()
        return true
      },
      'Mod-\\': () => this.editor.chain().focus().unsetAllMarks().run(),
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      // Always handled, so the browser's history shortcuts never leave the page while typing.
      'Mod-]': () => {
        void (this.editor.commands.sinkListItem('listItem') || this.editor.commands.sinkListItem('taskItem'))
        return true
      },
      'Mod-[': () => {
        void (this.editor.commands.liftListItem('listItem') || this.editor.commands.liftListItem('taskItem'))
        return true
      },
    }
  },
})
