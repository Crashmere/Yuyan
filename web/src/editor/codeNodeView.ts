import { VueNodeViewRenderer } from '@tiptap/vue-3'
import type { NodeViewRenderer } from '@tiptap/core'
import { codeEditorIn } from '../code/editor'
import CodeBlockView from './views/CodeBlockView.vue'

export const codeNodeView: NodeViewRenderer = props => {
  const view = VueNodeViewRenderer(CodeBlockView)(props)
  let focusFrame = 0
  view.setSelection = (anchor, head) => {
    cancelAnimationFrame(focusFrame)
    const select = () => {
      const pos = props.getPos(), selection = props.editor.state.selection
      if (typeof pos !== 'number' || selection.anchor !== pos + 1 + anchor || selection.head !== pos + 1 + head) return
      if (view.dom?.isConnected) codeEditorIn(view.dom)?.setSelection(anchor, head, true)
    }
    // Tiptap dispatches a focus transaction before the browser finishes a click in prose.
    // Wait for that native selection, otherwise the old code caret steals the click back.
    // Vue's node props and CodeMirror text have also settled by this point.
    focusFrame = requestAnimationFrame(select)
  }
  const destroy = view.destroy?.bind(view)
  view.destroy = () => { cancelAnimationFrame(focusFrame); destroy?.() }
  view.stopEvent = event => !(event.type === 'dragstart' && event.target === view.dom)
  return view
}
