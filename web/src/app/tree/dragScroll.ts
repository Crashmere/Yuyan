// Native dragover events are too sparse for continuous scrolling, especially when the pointer
// stays still. Track the pointer during this drag, and re-evaluate the drop row after each frame.
export function dragScroll(scroller: HTMLElement, locate: (x: number, y: number) => void): () => void {
  let x = -1, y = -1, frame = 0, last = 0
  function velocity() {
    const rect = scroller.getBoundingClientRect()
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return 0
    const edge = Math.min(80, rect.height / 3)
    const direction = y < rect.top + edge ? -1 : y > rect.bottom - edge ? 1 : 0
    if (!direction || (direction < 0 ? scroller.scrollTop <= 0 : scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight)) return 0
    const proximity = direction < 0 ? (rect.top + edge - y) / edge : (y - rect.bottom + edge) / edge
    return direction * (120 + 780 * proximity * proximity)
  }
  function step(now: number) {
    frame = 0
    if (!scroller.isConnected) { stop(); return }
    const speed = velocity()
    if (!speed) return
    const before = scroller.scrollTop
    scroller.scrollTop += speed * Math.min(32, now - last) / 1000
    last = now
    if (before !== scroller.scrollTop) locate(x, y)
    frame = requestAnimationFrame(step)
  }
  function over(e: DragEvent) {
    x = e.clientX; y = e.clientY
    if (!frame && velocity()) { last = performance.now(); frame = requestAnimationFrame(step) }
  }
  function leave(e: DragEvent) {
    if (!e.relatedTarget) { x = y = -1; cancelAnimationFrame(frame); frame = 0 }
  }
  function stop() {
    cancelAnimationFrame(frame)
    document.removeEventListener('dragover', over, true)
    document.removeEventListener('dragenter', over, true)
    document.removeEventListener('dragleave', leave, true)
    document.removeEventListener('drop', stop, true)
    document.removeEventListener('dragend', stop, true)
  }
  document.addEventListener('dragover', over, true)
  document.addEventListener('dragenter', over, true)
  document.addEventListener('dragleave', leave, true)
  document.addEventListener('drop', stop, true)
  document.addEventListener('dragend', stop, true)
  return stop
}
