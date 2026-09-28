import { Plugin, type Transaction } from '@tiptap/pm/state'
import { addColumn, addRow, CellSelection, TableMap } from '@tiptap/pm/tables'

type Axis = 'column' | 'row'

// One set of controls for the hovered table, outside the editable DOM. The rails follow the
// visible portion of a wide/long table; they never become document content or capture text drags.
export function tableControls(): Plugin {
  return new Plugin({
    view(view) {
      const root = Object.assign(document.createElement('div'), { className: 'yy-table-controls' })
      root.setAttribute('aria-label', '表格行列操作')
      const ring = root.appendChild(Object.assign(document.createElement('div'), { className: 'yy-table-ring' }))
      const preview = root.appendChild(Object.assign(document.createElement('div'), { className: 'yy-table-insert-line' }))
      document.body.appendChild(root)
      let table: HTMLTableElement | null = null
      let frame = 0
      let leaving: ReturnType<typeof setTimeout> | undefined
      let buttons: HTMLButtonElement[] = []
      let shape = ''
      let inserting: { axis: Axis; index: number } | null = null
      let dragging: { axis: Axis; start: number; end: number; pointer: number; coordinate: number } | null = null
      let boundaries: Record<Axis, number[]> = { column: [], row: [] }
      const observer = new ResizeObserver(schedule)

      function context() {
        if (!table?.isConnected || !view.dom.contains(table) || !view.editable) return null
        const $pos = view.state.doc.resolve(view.posAtDOM(table, 0))
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d)
          if (node.type.spec.tableRole !== 'table') continue
          const map = TableMap.get(node)
          if (map.map.some((pos) => pos <= 0)) return null
          return { table: node, map, pos: $pos.before(d), tableStart: $pos.start(d), left: 0, top: 0, right: map.width, bottom: map.height }
        }
        return null
      }

      function select(tr: Transaction, pos: number, axis: Axis, index: number, end = index) {
        const node = tr.doc.nodeAt(pos)!
        const map = TableMap.get(node)
        const start = pos + 1
        const first = axis === 'column' ? index : index * map.width
        const last = axis === 'column' ? (map.height - 1) * map.width + end : (end + 1) * map.width - 1
        const anchor = tr.doc.resolve(start + map.map[first])
        const head = tr.doc.resolve(start + map.map[last])
        return tr.setSelection(axis === 'column' ? CellSelection.colSelection(anchor, head) : CellSelection.rowSelection(anchor, head))
      }

      function stopDrag() {
        const pointer = dragging?.pointer
        dragging = null
        root.classList.remove('is-selecting')
        if (pointer !== undefined && root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer)
      }

      function updateDrag() {
        const drag = dragging
        const ctx = context()
        if (!drag || !ctx) return
        const points = boundaries[drag.axis]
        if (points.length < 2) return
        let end = 0
        while (end < points.length - 2 && drag.coordinate >= points[end + 1]) end++
        if (end === drag.end) return
        drag.end = end
        view.dispatch(select(view.state.tr, ctx.pos, drag.axis, drag.start, end))
      }

      function startDrag(event: PointerEvent, axis: Axis, index: number) {
        if (event.button !== 0 || !event.isPrimary) return
        const ctx = context()
        if (!ctx) return
        event.preventDefault()
        clearTimeout(leaving)
        leaving = undefined
        inserting = null
        dragging = { axis, start: index, end: index, pointer: event.pointerId, coordinate: axis === 'column' ? event.clientX : event.clientY }
        // Capture on the stable overlay so gaps, pointer drift and the floating toolbar cannot
        // interrupt a range selection or turn releasing the pointer into an insertion click.
        root.setPointerCapture(event.pointerId)
        root.classList.add('is-selecting')
        view.dispatch(select(view.state.tr, ctx.pos, axis, index))
        view.focus()
        schedule()
      }

      function button(axis: Axis, index: number, insert: boolean) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: insert ? 'yy-table-insert' : 'yy-table-select' })
        b.dataset.axis = axis
        b.dataset.index = String(index)
        const noun = axis === 'column' ? '列' : '行'
        b.setAttribute('aria-label', insert ? `在第 ${index + 1} ${noun}前插入${noun}` : `选中第 ${index + 1} ${noun}`)
        b.dataset.tip = insert ? `插入${noun}` : `选中整${noun}，按住拖动多选`
        b.addEventListener('mousedown', (e) => e.preventDefault())
        if (!insert) b.addEventListener('pointerdown', (e) => startDrag(e, axis, index))
        b.addEventListener('click', (e) => {
          // Pointer selection is handled on press/drag; retain click for keyboard activation.
          if (!insert && e.detail !== 0) return
          const ctx = context()
          if (!ctx) return
          let tr = view.state.tr
          if (insert) tr = axis === 'column' ? addColumn(tr, ctx, index) : addRow(tr, ctx, index)
          view.dispatch(select(tr, ctx.pos, axis, index))
          view.focus()
          inserting = null
          schedule()
        })
        if (insert) {
          b.addEventListener('pointerenter', () => { inserting = { axis, index }; schedule() })
          b.addEventListener('pointerleave', () => { inserting = null; schedule() })
          b.addEventListener('focus', () => { inserting = { axis, index }; schedule() })
          b.addEventListener('blur', () => { inserting = null; schedule() })
        }
        root.appendChild(b)
        buttons.push(b)
      }

      function measure() {
        const ctx = context()
        if (!ctx || !table) { hide(); return }
        const box = table.getBoundingClientRect()
        const scroll = table.closest('.yy-table-scroll')!.getBoundingClientRect()
        const toolbarBottom = document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0
        const left = Math.max(box.left, scroll.left, 32)
        const right = Math.min(box.right, scroll.right, innerWidth - 16)
        const top = Math.max(box.top, toolbarBottom)
        const bottom = Math.min(box.bottom, innerHeight - 16)
        if (right <= left || bottom <= top) { root.classList.remove('is-visible'); return }
        root.style.transform = `translate(${left}px, ${top}px)`
        root.style.width = `${right - left}px`
        root.style.height = `${bottom - top}px`
        const clippedTop = box.top < toolbarBottom + 4
        const clippedBottom = box.bottom > bottom
        ring.style.top = clippedTop ? '0' : '-4px'
        ring.style.borderTopStyle = clippedTop ? 'none' : 'solid'
        ring.style.borderBottomStyle = clippedBottom ? 'none' : 'solid'
        ring.style.borderTopLeftRadius = !clippedTop && box.left >= left ? '4px' : '0'
        ring.style.borderTopRightRadius = !clippedTop && box.right <= right ? '4px' : '0'
        ring.style.borderBottomLeftRadius = !clippedBottom && box.left >= left ? '4px' : '0'
        ring.style.borderBottomRightRadius = !clippedBottom && box.right <= right ? '4px' : '0'

        const nextShape = `${ctx.map.width}:${ctx.map.height}`
        if (shape !== nextShape) {
          stopDrag()
          buttons.forEach((b) => b.remove())
          buttons = []
          shape = nextShape
          inserting = null
          for (const axis of ['column', 'row'] as const) {
            const count = axis === 'column' ? ctx.map.width : ctx.map.height
            for (let i = 0; i < count; i++) button(axis, i, false)
            for (let i = 0; i <= count; i++) button(axis, i, true)
          }
        }
        const columns: number[] = []
        // Prefer unmerged cells. A spanned cell only supplies boundaries missing from other rows.
        const cells = [...new Set(ctx.map.map)].map((rel) => ({ rel, rect: ctx.map.findCell(rel) })).sort((a, b) => (a.rect.right - a.rect.left) - (b.rect.right - b.rect.left))
        for (const { rel, rect } of cells) {
          const dom = view.nodeDOM(ctx.tableStart + rel)
          if (!(dom instanceof HTMLElement)) continue
          const cell = dom.getBoundingClientRect()
          const widths = ctx.table.nodeAt(rel)!.attrs.colwidth as number[] | null
          const total = widths?.every(Boolean) ? widths.reduce((a, b) => a + b, 0) : 0
          let x = cell.left
          for (let i = rect.left; i < rect.right; i++) {
            columns[i] ??= x
            x += total ? cell.width * widths![i - rect.left] / total : cell.width / (rect.right - rect.left)
          }
          columns[rect.right] ??= cell.right
        }
        const rows = Array.from(table.rows, (r) => r.getBoundingClientRect().top)
        rows.push(box.bottom)
        boundaries = { column: columns, row: rows }
        const selection = view.state.selection
        const selected = selection instanceof CellSelection && selection.$anchorCell.node(-1) === ctx.table
          ? ctx.map.rectBetween(selection.$anchorCell.pos - ctx.tableStart, selection.$headCell.pos - ctx.tableStart) : null

        for (const b of buttons) {
          const column = b.dataset.axis === 'column'
          const i = Number(b.dataset.index)
          const insert = b.classList.contains('yy-table-insert')
          const points = column ? columns : rows
          const origin = column ? left : top
          const limit = column ? right : bottom
          const from = Math.max(points[i], origin)
          const to = Math.min(points[i + 1], limit)
          // Only hide a top control when the fixed toolbar would actually cover it. The smaller
          // selection rail fits closer to the toolbar than the insertion buttons above it.
          const fitsAbove = !column || box.top >= toolbarBottom + (insert ? 32 : 14)
          const visible = fitsAbove && (insert ? points[i] >= origin - 1 && points[i] <= limit + 1 && (column || points[i] >= toolbarBottom + 11) : to - from > 2)
          b.hidden = !visible
          if (!visible) continue
          const at = (insert ? points[i] : from) - origin
          b.style.left = `${column ? at - (insert ? 11 : 0) : insert ? -32 : -14}px`
          b.style.top = `${column ? insert ? -32 : -14 : at - (insert ? 11 : 0)}px`
          b.style.width = `${insert ? 22 : column ? to - from : 10}px`
          b.style.height = `${insert ? 22 : column ? 10 : to - from}px`
          if (!insert) b.setAttribute('aria-pressed', String(!!selected && (column ? selected.top === 0 && selected.bottom === ctx.map.height && i >= selected.left && i < selected.right : selected.left === 0 && selected.right === ctx.map.width && i >= selected.top && i < selected.bottom)))
        }
        preview.hidden = !inserting
        if (inserting) {
          const column = inserting.axis === 'column'
          const at = (column ? columns : rows)[inserting.index] - (column ? left : top)
          preview.style.left = `${column ? at - 1 : 0}px`
          preview.style.top = `${column ? 0 : at - 1}px`
          preview.style.width = column ? '2px' : '100%'
          preview.style.height = column ? '100%' : '2px'
        }
        // Scrolling during a drag moves the cells under the pointer, too.
        updateDrag()
      }

      function schedule() {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(measure)
      }
      function hide() {
        stopDrag()
        clearTimeout(leaving)
        leaving = undefined
        root.classList.remove('is-visible')
        root.inert = true
        inserting = null
        preview.hidden = true
        observer.disconnect()
        table = null
      }
      function show(next: HTMLTableElement) {
        clearTimeout(leaving)
        leaving = undefined
        if (table !== next) {
          table = next
          shape = ''
          observer.disconnect()
          observer.observe(table)
          observer.observe(table.closest('.yy-table-scroll')!)
          measure()
        }
        root.inert = false
        root.classList.add('is-visible')
      }
      function move(e: PointerEvent) {
        if (dragging?.pointer === e.pointerId) {
          if (!(e.buttons & 1)) { stopDrag(); return }
          e.preventDefault()
          dragging.coordinate = dragging.axis === 'column' ? e.clientX : e.clientY
          updateDrag()
          return
        }
        if (e.buttons || e.pointerType === 'touch' || !view.editable) return
        const target = e.target instanceof Element ? e.target : null
        if (target && root.contains(target)) { clearTimeout(leaving); leaving = undefined; return }
        const next = target?.closest('table')
        if (next instanceof HTMLTableElement && view.dom.contains(next)) { show(next); return }
        // The rails extend 32 px above/left and end dots extend 11 px past each corner.
        // Include the gaps between them, with a little room for pointer drift.
        const box = table && root.getBoundingClientRect()
        if (box && e.clientX >= box.left - 40 && e.clientX <= box.right + 18 && e.clientY >= box.top - 40 && e.clientY <= box.bottom + 18) {
          clearTimeout(leaving)
          leaving = undefined
          return
        }
        if (!leaving) leaving = setTimeout(() => { leaving = undefined; hide() }, 120)
      }
      const scrolled = () => { inserting = null; schedule() }
      const pointerUp = (e: PointerEvent) => { if (dragging?.pointer === e.pointerId) stopDrag() }
      const pointerDown = (e: PointerEvent) => {
        if (e.target instanceof Element && !root.contains(e.target) && !e.target.closest('table')) hide()
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerdown', pointerDown)
      document.addEventListener('pointerup', pointerUp)
      document.addEventListener('pointercancel', pointerUp)
      root.addEventListener('lostpointercapture', stopDrag)
      addEventListener('blur', stopDrag)
      document.addEventListener('scroll', scrolled, true)
      addEventListener('resize', schedule)
      hide()
      return {
        update(_view, previous) {
          if (previous.doc !== view.state.doc) stopDrag()
          if (previous.doc !== view.state.doc || !previous.selection.eq(view.state.selection)) schedule()
        },
        destroy() {
          stopDrag()
          clearTimeout(leaving)
          cancelAnimationFrame(frame)
          observer.disconnect()
          root.remove()
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerdown', pointerDown)
          document.removeEventListener('pointerup', pointerUp)
          document.removeEventListener('pointercancel', pointerUp)
          removeEventListener('blur', stopDrag)
          document.removeEventListener('scroll', scrolled, true)
          removeEventListener('resize', schedule)
        },
      }
    },
  })
}
