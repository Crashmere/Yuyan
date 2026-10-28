const visible = new Set<(top: number) => void>()
let pending = 0
let tracked = 0

function schedule() {
  if (pending || !visible.size) return
  pending = requestAnimationFrame(() => {
    pending = 0
    const top = Math.max(0, ...Array.from(document.querySelectorAll('.yy-topbar, .yy-toolbar'), bar => bar.getBoundingClientRect().bottom))
    for (const update of visible) update(top)
  })
}

// Horizontal overflow prevents CSS sticky from following the page. Translate the real header
// cells within the table instead; Web Animations keep scroll updates out of ProseMirror's DOM
// observer and preserve editable content, selection, and the table's original layout geometry.
export function trackTableHeader(table: HTMLTableElement) {
  let rows: HTMLTableRowElement[] = []
  let cells: { dom: HTMLTableCellElement; animation?: Animation }[] = []
  let offset = 0
  let height = 0
  let dirty = true
  let disposed = false

  function reset() {
    for (const cell of cells) { cell.animation?.cancel(); cell.animation = undefined }
    offset = 0
  }

  function refresh() {
    reset()
    rows = []
    cells = []
    let spanning = 0
    for (const row of table.rows) {
      const children = Array.from(row.cells)
      if (children.some(cell => cell.tagName !== 'TH') || (!children.length && spanning <= rows.length)) break
      rows.push(row)
      for (const dom of children) {
        cells.push({ dom })
        spanning = Math.max(spanning, rows.length - 1 + dom.rowSpan)
      }
    }
    dirty = true
    schedule()
  }

  function update(top: number) {
    if (!cells.length) return
    const box = table.getBoundingClientRect()
    if (!table.getClientRects().length || box.bottom <= top) { reset(); return }
    const start = rows[0]!.getBoundingClientRect().top
    if (dirty) {
      height = Math.max(...rows.map(row => row.getBoundingClientRect().bottom), ...cells.map(cell => cell.dom.getBoundingClientRect().bottom - offset)) - start
      dirty = false
    }
    const next = Math.max(0, Math.min(top - start, box.bottom - height - start))
    if (next === offset) return
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

  const intersection = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) visible.add(update)
    else { visible.delete(update); reset() }
    schedule()
  })
  const mutations = new MutationObserver(refresh)
  mutations.observe(table, { childList: true, subtree: true, attributes: true, attributeFilter: ['rowspan', 'colspan'] })
  intersection.observe(table)
  if (tracked++ === 0) {
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
  }
  refresh()

  return {
    update() { dirty = true; schedule() },
    destroy() {
      if (disposed) return
      disposed = true
      intersection.disconnect()
      mutations.disconnect()
      visible.delete(update)
      reset()
      if (--tracked === 0) {
        document.removeEventListener('scroll', schedule, true)
        window.removeEventListener('resize', schedule)
        cancelAnimationFrame(pending)
        pending = 0
      }
    },
  }
}
