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

      function select(tr: Transaction, pos: number, axis: Axis, index: number) {
        const node = tr.doc.nodeAt(pos)!
        const map = TableMap.get(node)
        const start = pos + 1
        const first = axis === 'column' ? index : index * map.width
        const last = axis === 'column' ? (map.height - 1) * map.width + index : first + map.width - 1
        const anchor = tr.doc.resolve(start + map.map[first])
        const head = tr.doc.resolve(start + map.map[last])
        return tr.setSelection(axis === 'column' ? CellSelection.colSelection(anchor, head) : CellSelection.rowSelection(anchor, head))
      }

      function button(axis: Axis, index: number, insert: boolean) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: insert ? 'yy-table-insert' : 'yy-table-select' })
        b.dataset.axis = axis
        b.dataset.index = String(index)
        const noun = axis === 'column' ? '列' : '行'
        b.setAttribute('aria-label', insert ? `在第 ${index + 1} ${noun}前插入${noun}` : `选中第 ${index + 1} ${noun}`)
        b.dataset.tip = insert ? `插入${noun}` : `选中整${noun}`
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', () => {
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
        const floor = (document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0) + 76
        const left = Math.max(box.left, scroll.left, 32)
        const right = Math.min(box.right, scroll.right, innerWidth - 16)
        const top = Math.max(box.top, floor)
        const bottom = Math.min(box.bottom, innerHeight - 16)
        if (right <= left || bottom <= top) { root.classList.remove('is-visible'); return }
        root.style.transform = `translate(${left}px, ${top}px)`
        root.style.width = `${right - left}px`
        root.style.height = `${bottom - top}px`
        ring.style.borderTopLeftRadius = box.top >= floor && box.left >= left ? '4px' : '0'

        const nextShape = `${ctx.map.width}:${ctx.map.height}`
        if (shape !== nextShape) {
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
          const visible = insert ? points[i] >= origin - 1 && points[i] <= limit + 1 : to - from > 2
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
      }

      function schedule() {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(measure)
      }
      function hide() {
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
        if (e.buttons || e.pointerType === 'touch' || !view.editable) return
        const target = e.target instanceof Element ? e.target : null
        if (target && root.contains(target)) { clearTimeout(leaving); leaving = undefined; return }
        const next = target?.closest('table')
        if (next instanceof HTMLTableElement && view.dom.contains(next)) { show(next); return }
        if (!leaving) leaving = setTimeout(() => { leaving = undefined; hide() }, 120)
      }
      const scrolled = () => { inserting = null; schedule() }
      const pointerDown = (e: PointerEvent) => {
        if (e.target instanceof Element && !root.contains(e.target) && !e.target.closest('table')) hide()
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerdown', pointerDown)
      document.addEventListener('scroll', scrolled, true)
      addEventListener('resize', schedule)
      hide()
      return {
        update(_view, previous) {
          if (previous.doc !== view.state.doc || !previous.selection.eq(view.state.selection)) schedule()
        },
        destroy() {
          clearTimeout(leaving)
          cancelAnimationFrame(frame)
          observer.disconnect()
          root.remove()
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerdown', pointerDown)
          document.removeEventListener('scroll', scrolled, true)
          removeEventListener('resize', schedule)
        },
      }
    },
  })
}
