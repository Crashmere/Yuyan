type HeaderUpdate = (top: number, resized: boolean) => void
type HeaderCell = { dom: HTMLTableCellElement; animation?: Animation; border?: Animation }
const ViewTimeline = (globalThis as typeof globalThis & {
  ViewTimeline?: new (options: { subject: Element; axis: 'block'; inset: CSSNumericValue[] }) => AnimationTimeline
}).ViewTimeline
const visible = new Set<HeaderUpdate>()
let pending = 0
let tracked = 0
let resized = false

function topEdge() {
  const bottom = Math.max(0, ...Array.from(document.querySelectorAll('.yy-topbar, .yy-toolbar'), bar => bar.getBoundingClientRect().bottom))
  // Overlap the toolbar border so collapsed cell borders and subpixel rounding leave no seam.
  return Math.max(0, bottom - 1)
}

function schedule() {
  if (pending || !visible.size) return
  pending = requestAnimationFrame(() => {
    pending = 0
    const top = topEdge()
    for (const update of visible) update(top, resized)
    resized = false
  })
}

function onResize() { resized = true; schedule() }
function onScroll() {
  const top = topEdge()
  for (const update of visible) update(top, false)
}

// A timeline on the outer frame follows page scrolling despite the inner horizontal scroller.
// The browser moves the real header cells, without a scroll-event/rAF delay or DOM mutations.
export function trackTableHeader(table: HTMLTableElement, frame: HTMLElement) {
  let rows: HTMLTableRowElement[] = []
  let cells: HeaderCell[] = []
  let timeline: AnimationTimeline | undefined
  let timelineTop = -1
  let offset = 0
  let height = 0
  let dirty = true
  let disposed = false

  function resetCell(cell: HeaderCell) {
    cell.animation?.cancel(); cell.animation = undefined
    cell.border?.cancel(); cell.border = undefined
  }

  function reset() {
    for (const cell of cells) resetCell(cell)
    offset = 0
  }

  function refresh() {
    const previous = new Map(cells.map(cell => [cell.dom, cell]))
    rows = []
    cells = []
    let spanning = 0
    for (const row of table.rows) {
      const children = Array.from(row.cells)
      if (children.some(cell => cell.tagName !== 'TH') || (!children.length && spanning <= rows.length)) break
      rows.push(row)
      for (const dom of children) {
        cells.push(previous.get(dom) ?? { dom })
        previous.delete(dom)
        spanning = Math.max(spanning, rows.length - 1 + dom.rowSpan)
      }
    }
    for (const cell of previous.values()) resetCell(cell)
    dirty = true
    schedule()
  }

  function cellBottom(cell: HeaderCell) {
    const bottom = cell.dom.getBoundingClientRect().bottom
    if (!cell.animation) return bottom
    const transform = getComputedStyle(cell.dom).transform
    return bottom - (transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42)
  }

  function update(top: number, resized: boolean) {
    if (!cells.length) return
    if (resized) dirty = true
    if (ViewTimeline) {
      if (!dirty) return
      if (!table.getClientRects().length) { reset(); return }
      const box = frame.getBoundingClientRect()
      const start = rows[0]!.getBoundingClientRect().top
      const bottom = Math.max(...rows.map(row => row.getBoundingClientRect().bottom), ...cells.map(cellBottom))
      const travel = Math.max(0, table.getBoundingClientRect().bottom - bottom)
      dirty = false
      if (!travel) { reset(); return }
      const viewport = document.documentElement.clientHeight - top
      const range = viewport + box.height
      const from = (viewport + start - box.top) / range
      const to = from + travel / range
      const keyframes = [
        { offset: 0, transform: 'translateY(0px)' },
        { offset: from, transform: 'translateY(0px)' },
        { offset: to, transform: `translateY(${travel}px)` },
        { offset: 1, transform: `translateY(${travel}px)` },
      ]
      if (!timeline || timelineTop !== top) {
        timeline = new ViewTimeline({ subject: frame, axis: 'block', inset: [CSS.px(top), CSS.px(0)] })
        timelineTop = top
        for (const cell of cells) {
          if (cell.animation) cell.animation.timeline = timeline
          if (cell.border) cell.border.timeline = timeline
        }
      }
      const options: KeyframeAnimationOptions = { timeline, duration: 'auto', fill: 'both', easing: 'linear' }
      // Keep paint-only properties out of the transform effect so it can run on the compositor.
      const border = '0 0 0 1px var(--yy-border-strong)'
      for (const cell of cells) {
        // Keep active effects attached: cancel/recreate exposes the unpinned cells for a frame.
        if (cell.animation) (cell.animation.effect as KeyframeEffect).setKeyframes(keyframes)
        else cell.animation = cell.dom.animate(keyframes, options)
        const borderFrames = [
          { offset: 0, boxShadow: 'none' }, { offset: from, boxShadow: 'none' },
          { offset: from, boxShadow: border }, { offset: 1, boxShadow: border },
        ]
        if (cell.border) (cell.border.effect as KeyframeEffect).setKeyframes(borderFrames)
        else cell.border = cell.dom.animate(borderFrames, options)
      }
      return
    }
    const box = table.getBoundingClientRect()
    if (!table.getClientRects().length || box.bottom <= top) { reset(); return }
    const start = rows[0]!.getBoundingClientRect().top
    if (dirty) {
      height = Math.max(...rows.map(row => row.getBoundingClientRect().bottom), ...cells.map(cellBottom)) - start
      dirty = false
    }
    const next = Math.max(0, Math.min(top - start, box.bottom - height - start))
    if (next === offset && cells.every(cell => cell.animation)) return
    if (!next) { reset(); return }
    const keyframe = { transform: `translateY(${next}px)`, zIndex: '2', boxShadow: '0 0 0 1px var(--yy-border-strong)' }
    const keyframes = [keyframe, keyframe]
    for (const cell of cells) {
      if (cell.animation) (cell.animation.effect as KeyframeEffect).setKeyframes(keyframes)
      else {
        cell.animation = cell.dom.animate(keyframes, { duration: 1, fill: 'both' })
        cell.animation.pause()
      }
    }
    offset = next
  }

  const intersection = ViewTimeline ? undefined : new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) visible.add(update)
    else { visible.delete(update); reset() }
    schedule()
  })
  const mutations = new MutationObserver(records => {
    // CodeMirror and other cell content update their DOM while scrolling, without changing headers.
    if (records.some(record => record.type === 'attributes' || record.target instanceof Element && record.target.matches('table, thead, tbody, tfoot, tr'))) refresh()
  })
  mutations.observe(table, { childList: true, subtree: true, attributes: true, attributeFilter: ['rowspan', 'colspan'] })
  if (intersection) intersection.observe(table)
  else visible.add(update)
  if (tracked++ === 0) {
    if (!ViewTimeline) document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize)
  }
  refresh()

  return {
    update() { dirty = true; schedule() },
    destroy() {
      if (disposed) return
      disposed = true
      intersection?.disconnect()
      mutations.disconnect()
      visible.delete(update)
      reset()
      if (--tracked === 0) {
        document.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', onResize)
        cancelAnimationFrame(pending)
        pending = 0
      }
    },
  }
}
