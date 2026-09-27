import { Plugin } from '@tiptap/pm/state'
import { columnResizingPluginKey } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'

const hoverDelay = 250

// Keep ProseMirror's resize calculations and transactions, but only give it a border after the
// pointer rests there. Passing across a table must not flash handles or interrupt text selection.
export function withResizeDelay(plugin: Plugin): Plugin {
  if (plugin.spec.key !== columnResizingPluginKey) return plugin
  const events = plugin.props.handleDOMEvents!
  let timer: ReturnType<typeof setTimeout> | undefined
  let edge: { table: Element; x: number } | null = null
  let latest: MouseEvent | null = null
  let ready = false

  function clear(view: EditorView) {
    clearTimeout(timer)
    edge = latest = null
    ready = false
    const state = columnResizingPluginKey.getState(view.state)
    if (state && !state.dragging && state.activeHandle >= 0) view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }))
  }

  return new Plugin({
    ...plugin.spec,
    props: {
      ...plugin.spec.props,
      handleDOMEvents: {
        ...events,
        mousemove(view, event) {
          if (columnResizingPluginKey.getState(view.state)?.dragging) return false
          if (event.buttons || !view.editable) { clear(view); return false }
          const cell = event.target instanceof Element ? event.target.closest('td, th') : null
          const box = cell?.getBoundingClientRect()
          const x = box && (event.clientX - box.left <= 5 ? box.left : box.right - event.clientX <= 5 ? box.right : null)
          if (x == null || !cell) { clear(view); return false }
          const table = cell.closest('table')!
          if (!edge || edge.table !== table || Math.abs(edge.x - x) > 1) {
            clear(view)
            edge = { table, x }
            timer = setTimeout(() => {
              if (!view.isDestroyed && latest && table.isConnected) {
                ready = true
                events.mousemove?.call(plugin, view, latest)
              }
            }, hoverDelay)
          }
          latest = event
          if (ready) events.mousemove?.call(plugin, view, event)
          return false
        },
        mouseleave(view) {
          if (!columnResizingPluginKey.getState(view.state)?.dragging) clear(view)
          return false
        },
        mousedown(view, event) {
          clearTimeout(timer)
          if (!ready || event.button !== 0) { clear(view); return false }
          return events.mousedown?.call(plugin, view, event)
        },
      },
    },
    view(view) {
      let dragging = false
      const scrolled = () => {
        if (!columnResizingPluginKey.getState(view.state)?.dragging) clear(view)
      }
      document.addEventListener('scroll', scrolled, true)
      return {
        update(_view, previous) {
          const next = !!columnResizingPluginKey.getState(view.state)?.dragging
          if (next !== dragging) {
            dragging = next
            document.body.classList.toggle('yy-column-dragging', next)
          }
          // A pending hover cannot act on a cell removed or moved by an edit.
          if (!ready && previous.doc !== view.state.doc) clear(view)
        },
        destroy() {
          clearTimeout(timer)
          document.removeEventListener('scroll', scrolled, true)
          document.body.classList.remove('yy-column-dragging')
        },
      }
    },
  })
}

// Row height changes on release. Like column resizing, the border activates only after a pause.
export function rowResizing(): Plugin {
  let hover: { pos: number; row: HTMLTableRowElement } | null = null
  let ready = false
  let dragging = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let line: HTMLDivElement | null = null
  let endDrag: (() => void) | undefined

  function show(view: EditorView, row: HTMLTableRowElement, bottom: number) {
    line ??= Object.assign(document.createElement('div'), { className: 'yy-row-resize-line' })
    document.body.appendChild(line)
    const box = (row.closest('.yy-table-scroll') ?? row).getBoundingClientRect()
    const table = row.closest('table')!.getBoundingClientRect()
    const left = Math.max(box.left, table.left)
    line.style.transform = `translate(${left}px, ${bottom}px)`
    line.style.width = `${Math.min(box.right, table.right) - left}px`
    view.dom.classList.add('yy-row-resize')
  }
  function hide(view: EditorView) {
    clearTimeout(timer)
    hover = null
    ready = false
    line?.remove()
    if (view.dom.classList.contains('yy-row-resize')) view.dom.classList.remove('yy-row-resize')
  }

  return new Plugin({
    view(view) {
      const scrolled = () => { if (!dragging) hide(view) }
      document.addEventListener('scroll', scrolled, true)
      return {
        update(_view, previous) { if (!dragging && previous.doc !== view.state.doc) hide(view) },
        destroy() {
          endDrag?.()
          hide(view)
          document.removeEventListener('scroll', scrolled, true)
        },
      }
    },
    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          if (dragging || !view.editable) return false
          const cell = event.target instanceof Element ? event.target.closest('td, th') : null
          const row = cell?.parentElement
          const box = cell?.getBoundingClientRect()
          const columnBorder = !!box && (event.clientX - box.left <= 5 || box.right - event.clientX <= 5)
          if (event.buttons || !cell || !(row instanceof HTMLTableRowElement) || columnBorder || row.getBoundingClientRect().bottom - event.clientY > 4) {
            hide(view)
            return false
          }
          if (hover?.row === row) return false
          hide(view)
          const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0))
          for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name !== 'tableRow') continue
            hover = { pos: $pos.before(d), row }
            timer = setTimeout(() => {
              if (!view.isDestroyed && row.isConnected) {
                ready = true
                show(view, row, row.getBoundingClientRect().bottom)
              }
            }, hoverDelay)
            break
          }
          return false
        },
        mouseleave(view) { if (!dragging) hide(view); return false },
        mousedown(view, event) {
          clearTimeout(timer)
          if (!ready || !hover || event.button !== 0) { hide(view); return false }
          event.preventDefault()
          const { pos, row } = hover
          const top = row.getBoundingClientRect().top
          const startY = event.clientY
          const start = row.getBoundingClientRect().height
          let height = start
          dragging = true
          document.body.classList.add('yy-row-dragging')
          const move = (e: MouseEvent) => {
            height = Math.max(24, start + e.clientY - startY)
            show(view, row, top + height)
          }
          endDrag = () => {
            removeEventListener('mousemove', move)
            removeEventListener('mouseup', up)
            dragging = false
            document.body.classList.remove('yy-row-dragging')
            hide(view)
            endDrag = undefined
          }
          const up = () => {
            endDrag?.()
            const node = view.state.doc.nodeAt(pos)
            if (node?.type.name === 'tableRow' && Math.round(height) !== Math.round(start)) {
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, height: Math.round(height) }))
            }
          }
          addEventListener('mousemove', move)
          addEventListener('mouseup', up)
          return true
        },
      },
    },
  })
}
