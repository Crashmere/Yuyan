// BubbleMenu reuses a detached element. Establish each new selection's initial position before
// allowing CSS to interpolate later updates, so reopening never travels from the old selection.
export function toolbarMotion(element: () => unknown) {
  let frame = 0
  function reset() {
    cancelAnimationFrame(frame)
    frame = 0
    const el = element()
    if (el instanceof HTMLElement) el.classList.remove('yy-toolbar-following')
  }
  function onUpdate() {
    const el = element()
    if (frame || !(el instanceof HTMLElement) || el.classList.contains('yy-toolbar-following')) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!el.isConnected) return
      // Commit the first position while transitions are disabled.
      void el.offsetWidth
      el.classList.add('yy-toolbar-following')
    })
  }
  return { onShow: reset, onHide: reset, onDestroy: reset, onUpdate }
}
