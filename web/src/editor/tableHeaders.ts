import { ref } from 'vue'
import { findParentNode } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'

export const openTableMenu = ref<string | null>(null)
const findTable = findParentNode(n => n.type.name === 'table')

function rowHeaderState(table: PMNode, map: TableMap | null, rowIndex: number): 'header' | 'cell' | 'mixed' {
  const row = table.child(rowIndex)
  let header = false
  let cell = false
  if (row.childCount > 0) {
    row.forEach((child) => {
      if (child.type.name === 'tableHeader') header = true
      else if (child.type.name === 'tableCell') cell = true
    })
  } else {
    const resolved = map ?? TableMap.get(table)
    for (let col = 0; col < resolved.width; col++) {
      const node = table.nodeAt(resolved.map[rowIndex * resolved.width + col])
      if (node?.type.name === 'tableHeader') header = true
      else if (node?.type.name === 'tableCell') cell = true
    }
  }
  if (header && !cell) return 'header'
  if (cell && !header) return 'cell'
  return 'mixed'
}

export function isFirstRowHeader(table: PMNode): boolean {
  return table.childCount > 0 && rowHeaderState(table, null, 0) === 'header'
}

export function tableHeaderRowCount(table: PMNode): number | null {
  let map: TableMap | null = null
  const getMap = () => (map ??= TableMap.get(table))
  let count = 0
  while (count < table.childCount) {
    const row = table.child(count)
    const state = rowHeaderState(table, row.childCount > 0 ? null : getMap(), count)
    if (state !== 'header') break
    count++
  }
  for (let r = count; r < table.childCount; r++) {
    const row = table.child(r)
    if (rowHeaderState(table, row.childCount > 0 ? null : getMap(), r) !== 'cell') return null
  }
  return count
}

export function setTableHeaderRows(tr: Transaction, count: number): boolean {
  const found = findTable(tr.selection)
  if (!found) return false
  const { node: table, start } = found
  const { tableHeader, tableCell } = table.type.schema.nodes
  if (!tableHeader || !tableCell || table.childCount === 0) return false
  const targetCount = Math.max(0, Math.min(table.childCount, Math.trunc(count)))
  let pos = start
  for (let rowIndex = 0; rowIndex < table.childCount; rowIndex++) {
    const row = table.child(rowIndex)
    const targetType = rowIndex < targetCount ? tableHeader : tableCell
    let cellPos = pos + 1
    for (let cellIndex = 0; cellIndex < row.childCount; cellIndex++) {
      const cell = row.child(cellIndex)
      if ((cell.type === tableHeader || cell.type === tableCell) && cell.type !== targetType) {
        tr.setNodeMarkup(cellPos, targetType, cell.attrs, cell.marks)
      }
      cellPos += cell.nodeSize
    }
    pos += row.nodeSize
  }
  return true
}
