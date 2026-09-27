import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { CellSelection } from '@tiptap/pm/tables'

// A rectangle of cells clears their contents; a complete row/column removes that structure.
// Covering both axes means the whole table, including one-row and one-column tables.
function removal(e: Editor) {
  const selection = e.state.selection
  if (selection.empty) return null
  if (selection instanceof CellSelection) {
    const row = selection.isRowSelection()
    const column = selection.isColSelection()
    if (row && column) return { command: 'deleteTable', label: '移除表格' } as const
    if (row) return { command: 'deleteRow', label: '移除选中行' } as const
    if (column) return { command: 'deleteColumn', label: '移除选中列' } as const
    return { command: 'deleteSelection', label: '清空选中单元格' } as const
  }
  return { command: 'deleteSelection', label: '移除选中内容' } as const
}

export function removalLabel(e: Editor) {
  return removal(e)?.label ?? '移除选中内容'
}

export function removeSelection(e: Editor) {
  const action = removal(e)
  if (!action || !e.isEditable) return
  e.chain().focus().command(({ tr }) => { closeHistory(tr); return true })[action.command]().run()
}
