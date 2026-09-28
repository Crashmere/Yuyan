import { onBeforeUnmount, onMounted } from 'vue'
import { toast } from '../ui/toast'

// Capture checks the UI before an Escape handler closes it. The bubbling handler only counts
// presses left unhandled by the editor, menus and dialogs (including CodeMirror selections).
export function useModeShortcut(key: string, hint: string, eligible: (event: KeyboardEvent) => boolean, run: () => void) {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  let dismiss: (() => void) | undefined
  let candidate: KeyboardEvent | undefined
  const reset = () => {
    last = -Infinity
    candidate = undefined
    clearTimeout(timer)
    dismiss?.()
  }
  const capture = (e: KeyboardEvent) => {
    candidate = undefined
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey || (e.shiftKey && key === 'Escape') || e.key.toLowerCase() !== key.toLowerCase()
      || !eligible(e) || document.querySelector('[role="dialog"], [role="menu"], dialog[open], .yy-find, .yy-slash, .cm-search')) {
      reset()
      return
    }
    // Holding the key does not count as a second press or extend the double-press window.
    if (!e.repeat) candidate = e
  }
  const bubble = (e: KeyboardEvent) => {
    if (candidate !== e) return
    // ProseMirror always prevents the browser's native Escape, even when no command ran.
    // Its open panels were excluded during capture; CodeMirror still owns handled Escapes.
    const plainEditor = e.target instanceof Element && e.target.closest('.ProseMirror') && !e.target.closest('.cm-editor')
    if (e.defaultPrevented && !(key === 'Escape' && plainEditor)) { reset(); return }
    e.preventDefault()
    clearTimeout(timer)
    dismiss?.()
    const now = performance.now()
    if (now - last < 400) {
      reset()
      run()
    } else {
      last = now
      timer = setTimeout(() => { dismiss = toast(hint, 'info', { key: 'mode-hint', ms: 1800 }) }, 400)
    }
  }
  onMounted(() => {
    window.addEventListener('keydown', capture, true)
    window.addEventListener('keydown', bubble)
    window.addEventListener('pointerdown', reset, true)
    window.addEventListener('input', reset, true)
    window.addEventListener('compositionstart', reset, true)
    window.addEventListener('blur', reset)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', capture, true)
    window.removeEventListener('keydown', bubble)
    window.removeEventListener('pointerdown', reset, true)
    window.removeEventListener('input', reset, true)
    window.removeEventListener('compositionstart', reset, true)
    window.removeEventListener('blur', reset)
    reset()
  })
}
