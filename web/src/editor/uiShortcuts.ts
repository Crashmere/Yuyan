import { Extension } from '@tiptap/core'

// Shortcuts that open the editor's panels, plus the Yuque shortcuts Tiptap binds differently or
// not at all.
export const UiShortcuts = Extension.create<{ openLink: () => void; openFind: () => void; openShortcuts: () => void }>({
  name: 'uiShortcuts',

  addOptions() {
    return { openLink: () => {}, openFind: () => {}, openShortcuts: () => {} }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        this.options.openLink()
        return true
      },
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
