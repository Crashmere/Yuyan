import { Extension, type Editor, type NodeViewRenderer } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection, Plugin, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Content remains owned by ProseMirror; only the folding button is outside contentDOM.
export const foldBlockView: NodeViewRenderer = ({ node: initial, editor, getPos }) => {
  let node = initial
  const dom = document.createElement('div'), contentDOM = document.createElement('div'), button = document.createElement('button')
  dom.className = 'yy-fold-block yy-fold-editor'
  dom.dataset.foldBlock = ''
  button.type = 'button'; button.contentEditable = 'false'; button.className = 'yy-fold-toggle'
  contentDOM.className = 'yy-fold-inner'
  dom.append(button, contentDOM)
  const update = () => {
    dom.dataset.collapsed = String(!!node.attrs.collapsed)
    button.setAttribute('aria-expanded', String(!node.attrs.collapsed))
    button.setAttribute('aria-label', node.attrs.collapsed ? '展开折叠块' : '收起折叠块')
    button.dataset.tip = node.attrs.collapsed ? '展开折叠块' : '收起折叠块'
  }
  button.addEventListener('mousedown', e => e.preventDefault())
  button.addEventListener('click', () => {
    const pos = getPos()
    if (pos === undefined || !editor.isEditable) return
    const collapsed = !node.attrs.collapsed, tr = editor.state.tr
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed })
    if (collapsed && tr.selection.from < pos + node.nodeSize && tr.selection.to > pos + 1 + node.firstChild!.nodeSize) {
      tr.setSelection(TextSelection.create(tr.doc, pos + node.firstChild!.nodeSize))
    }
    editor.view.dispatch(closeHistory(tr)); editor.view.dispatch(closeHistory(editor.state.tr))
    editor.commands.focus(undefined, { scrollIntoView: false })
  })
  update()
  return {
    dom, contentDOM,
    update(next) { if (next.type !== node.type) return false; node = next; update(); return true },
    stopEvent: event => button.contains(event.target as globalThis.Node),
    ignoreMutation: mutation => mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
  }
}

export function activeHighlight(state: EditorState) {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'highlightBlock') return { node: selection.node, pos: selection.from }
  const { $from, to } = selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'highlightBlock' && to <= $from.end(d)) return { node: $from.node(d), pos: $from.before(d) }
  }
  return null
}

// Wrap the current blocks without flattening rich content or losing a selected image/table.
export function insertContainer(editor: Editor, type: 'foldBlock' | 'highlightBlock'): boolean {
  const { state } = editor, { $from, $to } = state.selection
  const range = $from.blockRange($to), kind = state.schema.nodes[type]
  if (!range || !range.parent.canReplaceWith(range.startIndex, range.endIndex, kind)) return false
  const body = state.doc.slice(range.start, range.end).content
  const node = type === 'foldBlock'
    ? kind.create(null, [state.schema.nodes.foldTitle.create(), state.schema.nodes.foldContent.create(null, body)])
    : kind.create(null, body)
  const tr = state.tr.replaceWith(range.start, range.end, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.start + (type === 'foldBlock' ? 2 : 1))))
  editor.view.dispatch(closeHistory(tr)); editor.view.dispatch(closeHistory(editor.state.tr))
  editor.commands.focus()
  return true
}

function enterFoldContent(editor: Editor): boolean {
  const { state } = editor, { $from, $to } = state.selection
  if ($from.parent.type.name !== 'foldTitle' || !$from.sameParent($to) || editor.view.composing) return false
  const pos = $from.before($from.depth - 1), block = state.doc.nodeAt(pos)!
  const tr = state.tr
  if (block.attrs.collapsed) tr.setNodeMarkup(pos, undefined, { ...block.attrs, collapsed: false })
  tr.setSelection(TextSelection.near(tr.doc.resolve($from.after() + 1))).scrollIntoView()
  editor.view.dispatch(tr)
  return true
}

export const BlockContainers = Extension.create({
  name: 'blockContainers',
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => enterFoldContent(editor),
      Enter: ({ editor }) => {
        const { state } = editor, { $from, empty } = state.selection
        if (!empty) return false
        if ($from.parent.type.name === 'foldTitle') {
          return enterFoldContent(editor)
        }
        const depth = $from.depth, parent = depth > 1 ? $from.node(depth - 1) : null
        if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size || !parent || !['foldContent', 'highlightBlock'].includes(parent.type.name) || $from.index(depth - 1) !== parent.childCount - 1) return false
        const end = $from.after(parent.type.name === 'foldContent' ? depth - 2 : depth - 1), tr = state.tr
        if (parent.childCount > 1) tr.delete($from.before(), $from.after())
        const pos = tr.mapping.map(end)
        tr.insert(pos, state.schema.nodes.paragraph.create()).setSelection(TextSelection.create(tr.doc, pos + 1))
        editor.view.dispatch(tr); return true
      },
      Backspace: ({ editor }) => {
        const { state } = editor, { $from, empty } = state.selection
        if (!empty || $from.parentOffset || $from.parent.type.name !== 'foldTitle') return false
        const depth = $from.depth - 1, block = $from.node(depth), pos = $from.before(depth)
        const title = state.schema.nodes.paragraph.create(null, block.firstChild!.content)
        const content = Fragment.from(title).append(block.lastChild!.content)
        const tr = state.tr.replaceWith(pos, pos + block.nodeSize, content)
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
        editor.view.dispatch(closeHistory(tr)); editor.view.dispatch(closeHistory(editor.state.tr)); return true
      },
    }
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: { decorations(state) {
        const active = activeHighlight(state)
        return active ? DecorationSet.create(state.doc, [Decoration.node(active.pos, active.pos + active.node.nodeSize, { class: 'yy-highlight-selected' })]) : null
      } },
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(tr => tr.selectionSet)) return null
        const tr = state.tr
        for (const endpoint of [state.selection.$from, state.selection.$to]) {
          for (let d = endpoint.depth; d > 0; d--) {
            const node = endpoint.node(d)
            if (node.type.name === 'foldBlock' && node.attrs.collapsed && endpoint.pos > endpoint.start(d) + node.firstChild!.nodeSize) {
              tr.setNodeMarkup(endpoint.before(d), undefined, { ...node.attrs, collapsed: false })
            }
          }
        }
        return tr.docChanged ? tr : null
      },
    })]
  },
})
