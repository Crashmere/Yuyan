import { Extension, findParentNode, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, Plugin, type Transaction } from '@tiptap/pm/state'
import { columnResizingPluginKey, isInTable, selectedRect, TableMap } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'
import { TableView } from '@tiptap/extension-table'
import { frameTable } from '../shared/tableFrame'

export type Align = 'left' | 'center' | 'right' | null

const findTable = findParentNode((n) => n.type.name === 'table')

// The cell at a table map entry. Rows shorter than the widest row have no cell at the missing
// entries (the map points at the table start there); imported notes contain such tables.
function cellAt(table: PMNode, rel: number): PMNode | null {
  const node = table.nodeAt(rel)
  const role = node?.type.spec.tableRole
  return role === 'cell' || role === 'header_cell' ? node : null
}

// Markdown tables have exactly one header row and one alignment per column. Structural edits
// (inserting a row above the header, deleting the header row, Tab adding a row at the end) would
// leave other shapes, so the table under the cursor is put back into that shape after each change:
// the first row holds header cells, the other rows plain cells, and every cell takes its column's
// alignment. Tables from Markdown already have this shape, so loading a document changes nothing.
// Once columns have widths (from dragging a border), a column without one, such as a new column,
// gets their average, so the table keeps a width for every column.
function normalize(tr: Transaction, table: PMNode, start: number): boolean {
  const map = TableMap.get(table)
  const { tableHeader, tableCell } = table.type.schema.nodes
  const aligns: Align[] = []
  const widths: (number | null)[] = []
  for (let col = 0; col < map.width; col++) {
    let align: Align = null
    let width: number | null = null
    for (let row = 0; row < map.height && (!align || !width); row++) {
      const rel = map.map[row * map.width + col]
      const cell = cellAt(table, rel)
      align ||= (cell?.attrs.align ?? null) as Align
      width ||= (cell?.attrs.colwidth as number[] | null)?.[col - map.findCell(rel).left] || null
    }
    aligns.push(align)
    widths.push(width)
  }
  const known = widths.filter((w): w is number => !!w)
  const fill = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null
  const seen = new Set<number>()
  let changed = false
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const rel = map.map[row * map.width + col]
      if (seen.has(rel)) continue
      seen.add(rel)
      const node = cellAt(table, rel)
      if (!node) continue
      const type = row === 0 ? tableHeader : tableCell
      const rect = map.findCell(rel)
      const colwidth = fill ? widths.slice(rect.left, rect.right).map((w) => w ?? fill) : node.attrs.colwidth
      if (node.type === type && node.attrs.align === aligns[col] && JSON.stringify(node.attrs.colwidth) === JSON.stringify(colwidth)) continue
      tr.setNodeMarkup(start + rel, type, { ...node.attrs, align: aligns[col], colwidth })
      changed = true
    }
  }
  return changed
}

// The number of tables in a document that editing would reshape; the round-trip check expects none.
export function tablesToReshape(doc: PMNode): number {
  const tr = EditorState.create({ doc }).tr
  let count = 0
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true
    if (normalize(tr, node, pos + 1)) count++
    return false
  })
  return count
}

export const TableShape = Extension.create({
  name: 'tableShape',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged)) return null
          const found = findTable(state.selection)
          if (!found) return null
          const tr = state.tr
          return normalize(tr, found.node, found.start) ? tr : null
        },
      }),
    ]
  },
})

// Dragging a column border of a table whose columns have no widths yet first fixes every column at
// its current width, so each one can then be made narrower or wider exactly, as in Feishu, and the
// table can grow past the page (it scrolls sideways). It runs before prosemirror-tables' column
// resizing, which then drags the border.
export const fixColumnWidths = new Plugin({
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        if (event.button !== 0) return false
        const handle = columnResizingPluginKey.getState(view.state)?.activeHandle ?? -1
        if (handle < 0) return false
        const $cell = view.state.doc.resolve(handle)
        const table = $cell.node(-1)
        const start = $cell.start(-1)
        const map = TableMap.get(table)
        const cells = [...new Set(map.map)].flatMap((rel) => {
          const node = cellAt(table, rel)
          return node ? [{ rel, node, rect: map.findCell(rel) }] : []
        })
        if (cells.every((c) => (c.node.attrs.colwidth as number[] | null)?.every(Boolean))) return false
        const widths: number[] = []
        for (let col = 0; col < map.width; col++) {
          const spanning = cells.filter((c) => c.rect.left <= col && col < c.rect.right)
          const cell = spanning.find((c) => c.rect.right - c.rect.left === 1) ?? spanning[0]
          const dom = cell && view.nodeDOM(start + cell.rel)
          widths.push(dom instanceof HTMLElement ? Math.round(dom.getBoundingClientRect().width / (cell.rect.right - cell.rect.left)) : 100)
        }
        const tr = view.state.tr
        for (const c of cells) tr.setNodeMarkup(start + c.rel, undefined, { ...c.node.attrs, colwidth: widths.slice(c.rect.left, c.rect.right) })
        view.dispatch(tr)
        return false
      },
    },
  },
})

// Tiptap's table view inside the frame of wide tables, as on reading pages (shared/tableFrame.ts).
export class FramedTableView extends TableView {
  private release: () => void

  constructor(node: PMNode, cellMinWidth: number, view: EditorView, attrs?: Record<string, unknown>) {
    super(node, cellMinWidth, view, attrs)
    const scroller = this.dom
    scroller.classList.add('yy-table-scroll')
    const frame = document.createElement('div')
    frame.className = 'yy-table-frame'
    frame.append(scroller)
    this.dom = frame
    this.release = frameTable(frame, scroller)
  }

  stopEvent(event: Event) {
    return event.target instanceof Element && !!event.target.closest('.yy-table-bar')
  }

  destroy() {
    this.release()
  }
}

// While a column border is dragged past the right edge of the visible table, the border stays at
// the edge and the table scrolls left under it, so what the border reaches stays in view.
export const followColumnBorder = new Plugin({
  view(view) {
    let frame = 0
    const move = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const state = columnResizingPluginKey.getState(view.state)
        if (!state?.dragging || state.activeHandle < 0) return
        const cell = view.nodeDOM(state.activeHandle)
        const scroller = cell instanceof HTMLElement ? cell.closest<HTMLElement>('.yy-table-scroll') : null
        if (!cell || !scroller) return
        const over = (cell as HTMLElement).getBoundingClientRect().right - (scroller.getBoundingClientRect().right - 8)
        if (over > 0) scroller.scrollLeft += over
      })
    }
    addEventListener('mousemove', move)
    return {
      destroy() {
        removeEventListener('mousemove', move)
        cancelAnimationFrame(frame)
      },
    }
  },
})

export type TableCommand = 'addRowBefore' | 'addRowAfter' | 'addColumnBefore' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'deleteTable'

export function runTable(e: Editor, command: TableCommand) {
  e.chain().focus()[command]().run()
}

// The alignment of the first selected column, read from its header cell.
export function columnAlign(e: Editor): Align {
  if (!isInTable(e.state)) return null
  const rect = selectedRect(e.state)
  return (cellAt(rect.table, rect.map.map[rect.left])?.attrs.align ?? null) as Align
}

// Aligns whole columns, which is all Markdown can express.
export function setColumnAlign(e: Editor, align: Align) {
  if (!isInTable(e.state)) return
  const rect = selectedRect(e.state)
  const tr = e.state.tr
  const seen = new Set<number>()
  for (let row = 0; row < rect.map.height; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      const rel = rect.map.map[row * rect.map.width + col]
      if (seen.has(rel)) continue
      seen.add(rel)
      const node = cellAt(rect.table, rel)
      if (node) tr.setNodeMarkup(rect.tableStart + rel, undefined, { ...node.attrs, align })
    }
  }
  e.view.dispatch(tr)
  e.commands.focus()
}

// The element of the table holding the cursor.
export function tableElement(e: Editor): HTMLElement | null {
  const found = findTable(e.state.selection)
  if (!found) return null
  const dom = e.view.nodeDOM(found.pos)
  if (!(dom instanceof HTMLElement)) return null
  return dom.tagName === 'TABLE' ? dom : (dom.querySelector('table') ?? dom)
}
