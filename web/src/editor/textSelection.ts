import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'

// Text and cell selections share formatting tools. Other selected nodes and code get only the
// removal action; images keep their size/replacement tools with the same removal button.
export function hasTextTools(e: Editor): boolean {
  const selection = e.state.selection
  return !selection.empty && !(selection instanceof NodeSelection)
    && !e.isActive('codeBlock') && !e.isActive('image') && !e.isActive('inlineMath') && !e.isActive('blockMath')
}
