// Navigation scrolls finish within 160 ms. Long trips skip to just before the destination,
// retaining a short movement in the original direction without traversing unloaded content.
const running = new Map<HTMLElement, () => void>()

export function cancelScroll(scroller?: HTMLElement) {
  if (scroller) running.get(scroller)?.()
  else for (const stop of running.values()) stop()
}

export function scrollToPosition(scroller: HTMLElement, position: { top?: number; left?: number }, smooth = true) {
  cancelScroll(scroller)
  const top = Math.max(0, Math.min(position.top ?? scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight))
  const left = Math.max(0, Math.min(position.left ?? scroller.scrollLeft, scroller.scrollWidth - scroller.clientWidth))
  const dy = top - scroller.scrollTop, dx = left - scroller.scrollLeft
  const distance = Math.hypot(dx, dy)
  const write = (x: number, y: number) => scroller.scrollTo({ left: x, top: y, behavior: 'instant' })
  if (!smooth || distance < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) { write(left, top); return }
  const far = distance > 720
  const tail = Math.min(200, (Math.abs(dy) >= Math.abs(dx) ? scroller.clientHeight : scroller.clientWidth) / 4)
  const ratio = far ? Math.min(1, tail / distance) : 1
  const startX = left - dx * ratio, startY = top - dy * ratio
  const duration = far ? 130 : Math.max(80, Math.min(160, distance / 4.5))
  if (far) write(startX, startY)
  const began = performance.now()
  let frame = 0
  function stop() {
    cancelAnimationFrame(frame)
    running.delete(scroller)
    for (const event of ['wheel', 'touchstart', 'pointerdown']) window.removeEventListener(event, stop, true)
    window.removeEventListener('keydown', key, true)
  }
  function key(e: KeyboardEvent) {
    if (!e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Escape'].includes(e.key)) stop()
  }
  function step(now: number) {
    if (!scroller.isConnected) { stop(); return }
    const t = Math.min(1, (now - began) / duration)
    // Brief acceleration (10%) and braking (18%), with no long, slow easing tail.
    const progress = (t < 0.1 ? t * t / 0.2 : t > 0.82 ? 0.86 - (1 - t) ** 2 / 0.36 : t - 0.05) / 0.86
    write(startX + (left - startX) * progress, startY + (top - startY) * progress)
    if (t < 1) frame = requestAnimationFrame(step)
    else stop()
  }
  running.set(scroller, stop)
  for (const event of ['wheel', 'touchstart', 'pointerdown']) window.addEventListener(event, stop, { passive: true, capture: true })
  window.addEventListener('keydown', key, true)
  frame = requestAnimationFrame(step)
}

// Content navigation moves the page only; nested code and table scrollers keep their positions.
// Honour the same heading margins used by native scrollIntoView in reading and editing modes.
export function scrollToElement(target: Element, block: 'start' | 'center' = 'start', smooth = true) {
  const scroller = document.scrollingElement as HTMLElement | null
  if (!scroller || !target.isConnected) return
  const rect = target.getBoundingClientRect(), style = getComputedStyle(target)
  const margin = parseFloat(style.scrollMarginTop) || 0
  const offset = block === 'center' ? Math.max(margin, (innerHeight - rect.height) / 2) : margin
  scrollToPosition(scroller, { top: scroller.scrollTop + rect.top - offset }, smooth)
}
