import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

// Both floating toolbars use the same rule: selected text gets formatting tools, while cells,
// rows, columns and whole blocks keep their own tools. The fixed toolbar still formats cells.
export function hasTextTools(e: Editor): boolean {
  const selection = e.state.selection
  return !selection.empty && !(selection instanceof CellSelection) && !(selection instanceof NodeSelection)
    && !e.isActive('codeBlock') && !e.isActive('image') && !e.isActive('inlineMath') && !e.isActive('blockMath')
}
