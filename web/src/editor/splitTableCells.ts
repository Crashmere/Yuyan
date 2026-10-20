import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state'
import { CellSelection, TableMap } from '@tiptap/pm/tables'

export type CellSplitDirection = 'horizontal' | 'vertical'

interface CellOrigin {
  rel: number
  node: PMNode
  rect: { left: number; right: number; top: number; bottom: number }
}

function selectionContext(selection: Selection) {
  if (!(selection instanceof CellSelection) || selection.$anchorCell.node(-1) !== selection.$headCell.node(-1)) return null
  const table = selection.$anchorCell.node(-1)
  const tableStart = selection.$anchorCell.start(-1)
  const map = TableMap.get(table)
  const rect = map.rectBetween(selection.$anchorCell.pos - tableStart, selection.$headCell.pos - tableStart)
  if (rect.right - rect.left > 1 && rect.bottom - rect.top > 1) return null
  const selected = new Set<number>()
  selection.forEachCell((_node, pos) => selected.add(pos - tableStart))
  return { selection, table, tableStart, map, rect, selected }
}

export function canSplitSelectedCells(state: EditorState): boolean {
  return !!selectionContext(state.selection)
}

function origins(table: PMNode, map: TableMap): CellOrigin[] {
  return [...new Set(map.map)].flatMap((rel) => {
    const node = table.nodeAt(rel)
    const role = node?.type.spec.tableRole
    return node && (role === 'cell' || role === 'header_cell') ? [{ rel, node, rect: map.findCell(rel) }] : []
  }).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
}

function points(size: number, cells: CellOrigin[], direction: CellSplitDirection): number[] {
  const result = new Set(Array.from({ length: size + 1 }, (_, i) => i))
  for (const cell of cells) {
    result.add(direction === 'horizontal'
      ? (cell.rect.left + cell.rect.right) / 2
      : (cell.rect.top + cell.rect.bottom) / 2)
  }
  return [...result].sort((a, b) => a - b)
}

function pointIndex(axis: number[], value: number): number {
  const index = axis.indexOf(value)
  if (index < 0) throw new RangeError(`Missing split coordinate ${value}`)
  return index
}

function transformedWidths(node: PMNode, left: number, axis: number[], from: number, to: number): number[] | null {
  const widths = node.attrs.colwidth as number[] | null
  if (!widths || widths.length < node.attrs.colspan || !widths.every((width) => width > 0)) return null
  const result: number[] = []
  for (let i = from; i < to; i++) {
    const start = axis[i]
    const end = axis[i + 1]
    const column = Math.floor(start)
    const width = widths[column - left]
    result.push(Math.max(1, Math.round(width * (end - column)) - Math.round(width * (start - column))))
  }
  return result
}

function cellAttrs(node: PMNode, colspan: number, rowspan: number, colwidth: number[] | null = node.attrs.colwidth) {
  return { ...node.attrs, colspan, rowspan, colwidth }
}

function originalCell(node: PMNode, attrs: Record<string, unknown>) {
  return node.type.createChecked(attrs, node.content, node.marks)
}

function emptyCell(node: PMNode, attrs: Record<string, unknown>) {
  const empty = node.type.createAndFill(attrs)
  if (!empty) throw new RangeError(`Cannot create empty ${node.type.name}`)
  return empty
}

function splitHorizontally(table: PMNode, map: TableMap, all: CellOrigin[], selected: Set<number>) {
  const chosen = all.filter((cell) => selected.has(cell.rel))
  const axis = points(map.width, chosen, 'horizontal')
  const rows: PMNode[] = []
  for (let rowIndex = 0; rowIndex < map.height; rowIndex++) {
    const cells: PMNode[] = []
    for (const cell of all.filter((item) => item.rect.top === rowIndex)) {
      const left = pointIndex(axis, cell.rect.left)
      const right = pointIndex(axis, cell.rect.right)
      const rowspan = cell.rect.bottom - cell.rect.top
      if (!selected.has(cell.rel)) {
        cells.push(originalCell(cell.node, cellAttrs(cell.node, right - left, rowspan, transformedWidths(cell.node, cell.rect.left, axis, left, right))))
        continue
      }
      const middle = pointIndex(axis, (cell.rect.left + cell.rect.right) / 2)
      cells.push(
        originalCell(cell.node, cellAttrs(cell.node, middle - left, rowspan, transformedWidths(cell.node, cell.rect.left, axis, left, middle))),
        emptyCell(cell.node, cellAttrs(cell.node, right - middle, rowspan, transformedWidths(cell.node, cell.rect.left, axis, middle, right))),
      )
    }
    const oldRow = table.child(rowIndex)
    rows.push(oldRow.type.createChecked(oldRow.attrs, cells, oldRow.marks))
  }
  return { table: table.type.createChecked(table.attrs, rows, table.marks), axis }
}

function rowAttrs(row: PMNode, start: number, end: number) {
  const attrs = { ...row.attrs }
  const height = Number(attrs.height) || 0
  if (height && end - start < 1) {
    const base = Math.floor(start)
    attrs.height = Math.max(1, Math.round(height * (end - base)) - Math.round(height * (start - base)))
  }
  return attrs
}

function splitVertically(table: PMNode, map: TableMap, all: CellOrigin[], selected: Set<number>) {
  const chosen = all.filter((cell) => selected.has(cell.rel))
  const axis = points(map.height, chosen, 'vertical')
  const rowCells: { left: number; node: PMNode }[][] = Array.from({ length: axis.length - 1 }, () => [])
  for (const cell of all) {
    const top = pointIndex(axis, cell.rect.top)
    const bottom = pointIndex(axis, cell.rect.bottom)
    const colspan = cell.rect.right - cell.rect.left
    if (!selected.has(cell.rel)) {
      rowCells[top].push({ left: cell.rect.left, node: originalCell(cell.node, cellAttrs(cell.node, colspan, bottom - top)) })
      continue
    }
    const middle = pointIndex(axis, (cell.rect.top + cell.rect.bottom) / 2)
    rowCells[top].push({ left: cell.rect.left, node: originalCell(cell.node, cellAttrs(cell.node, colspan, middle - top)) })
    rowCells[middle].push({ left: cell.rect.left, node: emptyCell(cell.node, cellAttrs(cell.node, colspan, bottom - middle)) })
  }
  const rows = rowCells.map((entries, index) => {
    const start = axis[index]
    const oldRow = table.child(Math.floor(start))
    const cells = entries.sort((a, b) => a.left - b.left).map(entry => entry.node)
    return oldRow.type.createChecked(rowAttrs(oldRow, start, axis[index + 1]), cells, oldRow.marks)
  })
  return { table: table.type.createChecked(table.attrs, rows, table.marks), axis }
}

export function splitSelectedCells(tr: Transaction, direction: CellSplitDirection): boolean {
  const context = selectionContext(tr.selection)
  if (!context) return false
  const all = origins(context.table, context.map)
  const result = direction === 'horizontal'
    ? splitHorizontally(context.table, context.map, all, context.selected)
    : splitVertically(context.table, context.map, all, context.selected)
  const tablePos = context.tableStart - 1
  tr.replaceWith(tablePos, tablePos + context.table.nodeSize, result.table)

  const newMap = TableMap.get(result.table)
  const left = direction === 'horizontal' ? pointIndex(result.axis, context.rect.left) : context.rect.left
  const right = direction === 'horizontal' ? pointIndex(result.axis, context.rect.right) : context.rect.right
  const top = direction === 'vertical' ? pointIndex(result.axis, context.rect.top) : context.rect.top
  const bottom = direction === 'vertical' ? pointIndex(result.axis, context.rect.bottom) : context.rect.bottom
  tr.setSelection(CellSelection.create(
    tr.doc,
    context.tableStart + newMap.map[top * newMap.width + left],
    context.tableStart + newMap.map[(bottom - 1) * newMap.width + right - 1],
  ))
  return true
}
