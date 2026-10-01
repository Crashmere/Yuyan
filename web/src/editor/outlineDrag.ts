import type { SectionSide } from './moveSection'

interface Target { key: string; side: SectionSide; row: HTMLElement }

// Mouse users can drag the title itself; touch users drag the grip, leaving title text available
// for scrolling. The document is changed only on release, never during the preview.
export function outlineDrag(root: HTMLElement, options: {
  version: () => unknown
  canMove: (source: string, target: string, side: SectionSide) => boolean
  move: (source: string, target: string, side: SectionSide) => void
}) {
  let stop: (() => void) | undefined, suppressClick = false
  const click = (event: MouseEvent) => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false }
  }
  const down = (event: PointerEvent) => {
    const el = event.target instanceof Element ? event.target : null
    if (!el || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !el.closest('a, .yy-toc-drag')) return
    if (event.pointerType !== 'mouse' && !el.closest('.yy-toc-drag')) return
    const row = el.closest<HTMLElement>('[data-outline-key]'), source = row?.dataset.outlineKey
    if (!row || !source) return
    stop?.(); suppressClick = false
    const version = options.version(), startX = event.clientX, startY = event.clientY
    let x = startX, y = startY, dragging = false, target: Target | undefined, frame = 0
    const clearTarget = () => { target?.row.classList.remove('drop-before', 'drop-after'); target = undefined }
    const locate = () => {
      clearTarget()
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-outline-key]')
      if (!row || !root.contains(row)) return
      const key = row.dataset.outlineKey!, rect = row.getBoundingClientRect(), side = y < rect.top + rect.height / 2 ? 'before' : 'after'
      if (options.canMove(source, key, side)) { target = { key, side, row }; row.classList.add(`drop-${side}`) }
    }
    const scroll = () => {
      if (options.version() !== version) { cleanup(); return }
      const panel = root.querySelector<HTMLElement>('.yy-toc-panel')
      const scroller = panel && panel.scrollHeight > panel.clientHeight ? panel : root.closest<HTMLElement>('.yy-doc-aside')
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        if (x >= rect.left && x <= rect.right) {
          const delta = y < rect.top + 28 ? -8 : y > rect.bottom - 28 ? 8 : 0
          if (delta) { scroller.scrollTop += delta; locate() }
        }
      }
      frame = requestAnimationFrame(scroll)
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      if (options.version() !== version) { cleanup(); return }
      x = next.clientX; y = next.clientY
      if (!dragging && Math.hypot(x - startX, y - startY) >= 5) {
        dragging = true; suppressClick = true; row.classList.add('is-dragging'); root.classList.add('is-reordering'); frame = requestAnimationFrame(scroll)
      }
      if (dragging) { next.preventDefault(); locate() }
    }
    const up = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      const destination = target, valid = options.version() === version
      cleanup()
      if (dragging && destination && valid) options.move(source, destination.key, destination.side)
    }
    const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); cleanup() } }
    const cleanup = () => {
      cancelAnimationFrame(frame); clearTarget(); row.classList.remove('is-dragging'); root.classList.remove('is-reordering')
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cleanup)
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cleanup); stop = undefined
    }
    stop = cleanup
    // Prevent native link dragging and selection; ordinary clicks still navigate on release.
    event.preventDefault()
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cleanup); window.addEventListener('keydown', key, true); window.addEventListener('blur', cleanup)
  }
  root.addEventListener('pointerdown', down); root.addEventListener('click', click, true)
  return () => { stop?.(); root.removeEventListener('pointerdown', down); root.removeEventListener('click', click, true) }
}
