// Wide tables, on reading pages (app/content/enhance.ts) and in the editor (editor/tables.ts). A
// table starts in line with the text; its scroll area reaches right past the text column as far as
// there is room before the outline, so a wide table shows more of itself, and left to the edge of
// the page, so a table scrolled left stays visible over the margin. What is still hidden at either
// side lies behind a shadow. The scrollbar spans the text column only, so it is drawn here: it
// shows while the table scrolls or the pointer is over it, and it drags. Tables inside callouts or
// lists stay within them. Returns a function that stops the tracking.
export function frameTable(frame: HTMLElement, scroller: HTMLElement): () => void {
  const bar = Object.assign(document.createElement('div'), { className: 'yy-table-bar', contentEditable: 'false' })
  const thumb = bar.appendChild(Object.assign(document.createElement('div'), { className: 'yy-table-thumb' }))
  frame.appendChild(bar)
  let bleed = 0
  let extend = 0
  let attached = false
  let idle: ReturnType<typeof setTimeout> | undefined
  const table = scroller.querySelector('table')
  const attributes = new MutationObserver(measure)
  if (table) attributes.observe(table, { attributes: true, attributeFilter: ['data-align'] })
  const observer = new ResizeObserver(measure)
  observer.observe(frame)
  if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)

  function measure() {
    const page = frame.closest('main')
    if (!page) {
      if (attached) release()
      return
    }
    const aside = page.querySelector<HTMLElement>('.yy-doc-aside')
    if (!attached && aside) observer.observe(aside)
    attached = true
    const box = frame.getBoundingClientRect()
    const left = box.left + bleed
    const right = box.right - extend
    const edge = page.getBoundingClientRect()
    const limit = aside?.getClientRects().length && !aside.classList.contains('is-peek') ? aside.getBoundingClientRect().left - 24 : edge.right - 48
    const top = !!frame.parentElement?.matches('.yy-content, .ProseMirror')
    bleed = top ? Math.max(0, Math.round(left - edge.left)) : 0
    extend = top ? Math.max(0, Math.round(limit - right)) : 0
    frame.style.setProperty('--bleed', `${bleed}px`)
    frame.style.setProperty('--extend', `${extend}px`)
    const align = table?.dataset.align
    const free = Math.max(0, right - left - (table?.getBoundingClientRect().width ?? 0))
    frame.style.setProperty('--table-offset', `${align === 'right' ? free : align === 'center' ? free / 2 : 0}px`)
    update()
  }

  function update() {
    const max = scroller.scrollWidth - scroller.clientWidth
    const at = scroller.scrollLeft
    frame.classList.toggle('is-scrollable', max > 1)
    frame.classList.toggle('has-left', at > bleed + 1)
    frame.classList.toggle('has-right', at < max - 1)
    if (max <= 1) return
    const track = bar.clientWidth
    const size = Math.max(24, (track * scroller.clientWidth) / scroller.scrollWidth)
    thumb.style.width = `${size}px`
    thumb.style.transform = `translateX(${((track - size) * at) / max}px)`
  }

  function onScroll() {
    update()
    bar.classList.add('is-active')
    clearTimeout(idle)
    idle = setTimeout(() => bar.classList.remove('is-active'), 1000)
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })

  thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    thumb.setPointerCapture(e.pointerId)
    thumb.classList.add('is-dragging')
    const startX = e.clientX
    const start = scroller.scrollLeft
    const move = (ev: PointerEvent) => {
      const max = scroller.scrollWidth - scroller.clientWidth
      scroller.scrollLeft = start + ((ev.clientX - startX) * max) / Math.max(1, bar.clientWidth - thumb.offsetWidth)
    }
    const end = () => {
      thumb.classList.remove('is-dragging')
      thumb.removeEventListener('pointermove', move)
      thumb.removeEventListener('pointerup', end)
      thumb.removeEventListener('pointercancel', end)
    }
    thumb.addEventListener('pointermove', move)
    thumb.addEventListener('pointerup', end)
    thumb.addEventListener('pointercancel', end)
  })
  // A click on the track beside the thumb pages that way.
  bar.addEventListener('pointerdown', (e) => {
    if (e.target !== bar) return
    e.preventDefault()
    const r = thumb.getBoundingClientRect()
    scroller.scrollBy({ left: (e.clientX < r.left ? -1 : 1) * scroller.clientWidth * 0.8, behavior: 'smooth' })
  })

  function release() {
    observer.disconnect()
    attributes.disconnect()
    scroller.removeEventListener('scroll', onScroll)
    clearTimeout(idle)
  }
  return release
}
