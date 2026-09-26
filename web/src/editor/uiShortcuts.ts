import { Extension } from '@tiptap/core'

// Shortcuts that open the editor's panels, plus the Yuque shortcuts Tiptap binds differently or
// not at all. Cmd/Ctrl+K is left to the page, where it opens the search panel.
export const UiShortcuts = Extension.create<{ openFind: () => void; openShortcuts: () => void }>({
  name: 'uiShortcuts',

  addOptions() {
    return { openFind: () => {}, openShortcuts: () => {} }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => {
        this.options.openFind()
        return true
      },
      'Mod-/': () => {
        this.options.openShortcuts()
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
