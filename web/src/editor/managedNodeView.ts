import type { NodeView } from '@tiptap/pm/view'

// These views render their content themselves and update it with transactions. Vue's renderer
// otherwise supplies a detached contentDOM for every non-leaf node. An ancestor DOM reparse
// (for example when a modal hides siblings from screen readers) would read that as empty.
// No contentDOM tells ProseMirror to preserve the node's model content when reparsing its DOM.
export function managedNodeView<T extends NodeView>(view: T): T {
  Object.defineProperty(view, 'contentDOM', { get: () => null })
  view.ignoreMutation = () => true
  return view
}
