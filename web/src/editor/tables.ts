import { Extension, findParentNode, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, Plugin, type Transaction } from '@tiptap/pm/state'
import { isInTable, selectedRect, TableMap } from '@tiptap/pm/tables'

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
function normalize(tr: Transaction, table: PMNode, start: number): boolean {
  const map = TableMap.get(table)
  const { tableHeader, tableCell } = table.type.schema.nodes
  const aligns: Align[] = []
  for (let col = 0; col < map.width; col++) {
    let align: Align = null
    for (let row = 0; row < map.height && !align; row++) align = (cellAt(table, map.map[row * map.width + col])?.attrs.align ?? null) as Align
    aligns.push(align)
  }
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
      if (node.type === type && node.attrs.align === aligns[col]) continue
      tr.setNodeMarkup(start + rel, type, { ...node.attrs, align: aligns[col] })
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
