import type { Editor, NodeViewRenderer } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state'
import { columnGrid, columnWidths } from '../schema/columns'

export function activeColumns(state: EditorState) {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'columns') return { node: selection.node, pos: selection.from, index: 0 }
  const { $from, to } = selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'columns' && to <= $from.end(d)) return { node: $from.node(d), pos: $from.before(d), index: $from.index(d) }
  }
  return null
}

function commit(editor: Editor, pos: number, old: PMNode, content: PMNode | Fragment, offset = 2) {
  const tr = editor.state.tr.replaceWith(pos, pos + old.nodeSize, content)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + offset, tr.doc.content.size)))).scrollIntoView()
  editor.view.dispatch(closeHistory(tr)); editor.view.dispatch(closeHistory(editor.state.tr))
  editor.commands.focus()
}

export function insertColumns(editor: Editor): boolean {
  const { state } = editor, { $from, $to } = state.selection
  const range = $from.blockRange($to), kind = state.schema.nodes.columns
  if (!range || !range.parent.canReplaceWith(range.startIndex, range.endIndex, kind)) return false
  const body = state.doc.slice(range.start, range.end).content
  const node = kind.create(null, [state.schema.nodes.column.create(null, body), state.schema.nodes.column.createAndFill()!])
  const tr = state.tr.replaceWith(range.start, range.end, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.start + 2)))
  editor.view.dispatch(closeHistory(tr)); editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.focus()
  return true
}

export function setColumnCount(editor: Editor, count: number) {
  const active = activeColumns(editor.state)
  if (!active || !Number.isInteger(count) || count < 2 || count > 4 || count === active.node.childCount) return
  const { node, pos } = active, children: PMNode[] = []
  node.forEach(child => children.push(child))
  if (count < children.length) {
    let body = children[count - 1].content
    for (const child of children.slice(count)) body = body.append(child.content)
    children.splice(count - 1, children.length, editor.schema.nodes.column.create(null, body))
  }
  while (children.length < count) children.push(editor.schema.nodes.column.createAndFill()!)
  const index = Math.min(active.index, count - 1)
  const offset = 2 + children.slice(0, index).reduce((sum, child) => sum + child.nodeSize, 0)
  commit(editor, pos, node, node.type.create({ ...node.attrs, widths: null }, children), offset)
}

export function setColumnWidths(editor: Editor, widths: number[] | null) {
  const active = activeColumns(editor.state)
  if (!active || (widths !== null && !columnWidths(widths, active.node.childCount))) return
  if (JSON.stringify(active.node.attrs.widths) === JSON.stringify(widths)) return
  editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(active.pos, undefined, { ...active.node.attrs, widths })))
  editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.focus(undefined, { scrollIntoView: false })
}

export function moveColumn(editor: Editor, direction: -1 | 1) {
  const active = activeColumns(editor.state)
  if (!active) return
  const { node, pos, index } = active, target = index + direction
  if (target < 0 || target >= node.childCount) return
  const children: PMNode[] = []
  node.forEach(child => children.push(child))
  ;[children[index], children[target]] = [children[target], children[index]]
  const widths = columnWidths(node.attrs.widths, node.childCount)
  if (widths) [widths[index], widths[target]] = [widths[target], widths[index]]
  const offset = 2 + children.slice(0, target).reduce((sum, child) => sum + child.nodeSize, 0)
  commit(editor, pos, node, node.type.create({ ...node.attrs, widths }, children), offset)
}

export function unwrapColumns(editor: Editor) {
  const active = activeColumns(editor.state)
  if (!active) return
  let body = Fragment.empty
  active.node.forEach(child => { body = body.append(child.content) })
  commit(editor, active.pos, active.node, body, 0)
}

// Real contentDOM stays mounted; handles live outside it. A drag previews styles only and
// commits one history step on release. Any intervening document edit cancels that preview.
export const columnsView: NodeViewRenderer = ({ node: initial, editor, getPos }) => {
  let node = initial, cancel: (() => void) | undefined
  const dom = document.createElement('div'), contentDOM = document.createElement('div'), handles = document.createElement('div')
  dom.className = 'yy-columns yy-columns-editor'; dom.dataset.columns = ''
  contentDOM.className = 'yy-columns-grid'; contentDOM.dataset.columnsContent = ''
  handles.className = 'yy-column-handles'; handles.contentEditable = 'false'
  dom.append(contentDOM, handles)
  function measure() {
    const rect = dom.getBoundingClientRect(), columns = Array.from(contentDOM.children)
    Array.from(handles.children).forEach((handle, i) => {
      const left = columns[i]?.getBoundingClientRect(), right = columns[i + 1]?.getBoundingClientRect()
      if (left && right) (handle as HTMLElement).style.left = `${(left.right + right.left) / 2 - rect.left}px`
    })
  }
  function paint(widths = node.attrs.widths) {
    contentDOM.style.gridTemplateColumns = columnGrid(widths, node.childCount)
    if (widths) dom.dataset.columnWidths = widths.join(',')
    else delete dom.dataset.columnWidths
    measure()
  }
  function draw() {
    handles.replaceChildren()
    for (let i = 0; i < node.childCount - 1; i++) {
      const handle = document.createElement('button')
      handle.type = 'button'; handle.className = 'yy-column-resize'; handle.tabIndex = -1
      handle.setAttribute('aria-label', `调整第 ${i + 1} 栏宽度`); handle.dataset.tip = '拖动调整栏宽'
      handle.addEventListener('pointerdown', e => start(e, i, handle)); handles.append(handle)
    }
    paint()
  }
  function start(event: PointerEvent, index: number, handle: HTMLElement) {
    if (event.button !== 0 || !editor.isEditable || editor.view.composing) return
    event.preventDefault(); event.stopPropagation(); cancel?.()
    const original = node, originalDoc = editor.state.doc, origin = event.clientX
    const sizes = Array.from(contentDOM.children).map(el => el.getBoundingClientRect().width)
    const total = sizes.reduce((a, b) => a + b, 0), pair = sizes[index] + sizes[index + 1]
    const min = Math.min(80, pair / 3)
    let widths: number[] | null = null
    handle.setPointerCapture(event.pointerId); dom.classList.add('is-resizing')
    const move = (e: PointerEvent) => {
      if (editor.state.doc !== originalDoc) { finish(false); return }
      const left = Math.max(min, Math.min(pair - min, sizes[index] + e.clientX - origin))
      widths = sizes.map((size, i) => Math.max(1, Math.round((i === index ? left : i === index + 1 ? pair - left : size) / total * 1000)))
      paint(widths)
    }
    const end = () => finish(true), abort = () => finish(false)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false) } }
    function finish(apply: boolean) {
      cancel = undefined
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', abort); handle.removeEventListener('lostpointercapture', abort)
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', abort)
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      dom.classList.remove('is-resizing'); paint()
      const pos = getPos()
      if (!apply || !widths || pos === undefined || editor.state.doc !== originalDoc || editor.state.doc.nodeAt(pos) !== original) return
      editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, widths })))
      editor.view.dispatch(closeHistory(editor.state.tr))
    }
    cancel = abort
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', abort); handle.addEventListener('lostpointercapture', abort)
    window.addEventListener('keydown', key, true); window.addEventListener('blur', abort)
  }
  const observer = new ResizeObserver(measure)
  observer.observe(contentDOM); draw()
  return {
    dom, contentDOM,
    update(next) { if (next.type !== node.type) return false; cancel?.(); node = next; draw(); return true },
    stopEvent: e => handles.contains(e.target as globalThis.Node),
    ignoreMutation: m => m.type !== 'selection' && (m.target === contentDOM ? m.type === 'attributes' : !contentDOM.contains(m.target)),
    destroy() { cancel?.(); observer.disconnect() },
  }
}
