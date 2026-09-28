import { onBeforeUnmount, onMounted } from 'vue'

// Tab belongs to document editing while this view is mounted. Let ProseMirror and CodeMirror
// handle indentation and table navigation, then suppress the browser's focus traversal fallback.
export function useEditingTab() {
  const isTab = (e: KeyboardEvent) => e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing
  const capture = (e: KeyboardEvent) => {
    if (!isTab(e)) return
    const target = e.target
    if (target instanceof HTMLElement && target.isContentEditable && target.closest('.ProseMirror, .cm-content')) return
    // Controls and modal focus scopes can move focus themselves, before the browser default.
    e.preventDefault()
    e.stopPropagation()
  }
  const fallback = (e: KeyboardEvent) => {
    if (isTab(e)) e.preventDefault()
  }
  onMounted(() => {
    window.addEventListener('keydown', capture, true)
    window.addEventListener('keydown', fallback)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', capture, true)
    window.removeEventListener('keydown', fallback)
  })
}
