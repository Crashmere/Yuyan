import { Extension, type Editor } from '@tiptap/core'
import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { commitSelectionChange, selectionContent, type SelectedText } from './selectionContent'

// Links carry a destination, so only visual marks belong to the brush.
const paintedMarks = ['bold', 'italic', 'underline', 'strike', 'code', 'textColor', 'highlight']
interface TextFormat {
  marks: readonly Mark[]
  block: { type: 'paragraph' | 'heading'; level?: number; textAlign?: string | null } | null
}
interface PainterState { format: TextFormat; persistent: boolean }
const painterKey = new PluginKey<PainterState | null>('yyFormatPainter')
export const formatPainterState = (state: EditorState) => painterKey.getState(state) ?? null

export function captureFormat(state: EditorState): TextFormat | null {
  const { selection } = state
  const first = selectionContent(state).text.reduce<SelectedText | undefined>((first, range) => !first || range.from < first.from ? range : first, undefined)
  const node = selection.empty ? selection.$from.parent : first?.parent
  if (!node?.isTextblock || node.type.spec.code || (!selection.empty && !first)) return null
  const marks = selection.empty ? state.storedMarks ?? selection.$from.marks() : first!.node.marks
  const type = node.type.name
  return {
    marks: marks.filter(mark => paintedMarks.includes(mark.type.name)),
    block: type === 'paragraph' ? { type, textAlign: node.attrs.textAlign ?? null } : type === 'heading' ? { type, level: node.attrs.level } : null,
  }
}

export function cancelFormatPainter(e: Editor) {
  if (formatPainterState(e.state)) e.view.dispatch(e.state.tr.setMeta(painterKey, null))
}

export function toggleFormatPainter(e: Editor, persistent = false) {
  if (!e.isEditable) return
  const current = formatPainterState(e.state)
  if (current && !persistent) { cancelFormatPainter(e); return }
  const format = current?.format ?? captureFormat(e.state)
  if (!format) return
  e.view.dispatch(e.state.tr.setMeta(painterKey, { format, persistent }).setMeta('bubbleMenu', 'hide'))
  e.commands.focus(undefined, { scrollIntoView: false })
}

// A click paints the current paragraph; a drag paints only the selected text. Paragraph styles
// affect the touched text blocks. Walk real cell ranges and never modify image/code contents.
export function applyFormatPainter(e: Editor): boolean {
  const painter = formatPainterState(e.state)
  if (!painter || !e.isEditable) return false
  const { doc, selection } = e.state
  const { $from } = selection
  if (selection.empty && (!$from.parent.isTextblock || $from.parent.type.spec.code)) return false
  const target = selection.empty ? TextSelection.create(doc, $from.start(), $from.end()) : selection
  const ranges = selectionContent({ doc, selection: target }).text
  if (!ranges.length && !(selection.empty && $from.parent.content.size === 0)) return false
  const blocks = new Map<number, PMNode>()
  if (selection.empty) blocks.set($from.before(), $from.parent)
  const tr = e.state.tr
  for (const range of ranges) {
    const pos = doc.resolve(range.from)
    blocks.set(pos.before(), pos.parent)
    for (const name of paintedMarks) tr.removeMark(range.from, range.to, e.schema.marks[name])
    for (const mark of painter.format.marks) {
      if (range.parent.type.allowsMarkType(mark.type)) tr.addMark(range.from, range.to, mark)
    }
  }
  if (painter.format.block) {
    const style = painter.format.block
    for (const [pos, node] of blocks) {
      if (!['paragraph', 'heading'].includes(node.type.name)) continue
      // setBlockType checks the parent schema, preserving list and table containers.
      tr.setBlockType(pos, pos + node.nodeSize, e.schema.nodes[style.type], {
        ...node.attrs, ...(style.type === 'heading' ? { level: style.level } : { textAlign: style.textAlign }),
      })
    }
  }
  let storedMarks: readonly Mark[] | undefined
  if (selection.empty && !$from.parent.content.size) {
    const kept = (e.state.storedMarks ?? $from.marks()).filter(mark => !paintedMarks.includes(mark.type.name))
    storedMarks = tr.doc.resolve(selection.from).parent.type.allowedMarks([...kept, ...painter.format.marks])
    tr.setStoredMarks(storedMarks)
  }
  tr.setMeta(painterKey, painter.persistent ? painter : null)
  if (tr.docChanged) {
    commitSelectionChange(e, tr)
    if (storedMarks) e.view.dispatch(e.state.tr.setStoredMarks(storedMarks))
  }
  else { e.view.dispatch(tr); e.commands.focus(undefined, { scrollIntoView: false }) }
  return true
}

export const FormatPainter = Extension.create({
  name: 'formatPainter',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin<PainterState | null>({
      key: painterKey,
      state: {
        init: () => null,
        apply(tr, previous) {
          const next = tr.getMeta(painterKey) as PainterState | null | undefined
          return next !== undefined ? next : tr.docChanged ? null : previous
        },
      },
      props: {
        attributes: state => ({ class: formatPainterState(state) ? 'yy-format-painting' : '' }),
      },
      view(view) {
        const owner = view.dom.ownerDocument
        let gesture: { id: number; x: number; y: number; touch: boolean } | null = null
        let pending: ReturnType<typeof setTimeout> | undefined
        const stop = () => { gesture = null; clearTimeout(pending) }
        const cancel = () => { stop(); if (!editor.isDestroyed) cancelFormatPainter(editor) }
        const down = (event: PointerEvent) => {
          stop()
          if (!formatPainterState(view.state) || event.button !== 0 || !event.isPrimary) return
          const target = event.target
          if (!(target instanceof Element) || target.closest('[data-format-painter]')) return
          const cellRail = target.closest('.yy-table-select')
          if (!view.dom.contains(target) && !cellRail) { cancel(); return }
          if (!cellRail && target.closest('.cm-editor, [contenteditable="false"], button, input, textarea')) return
          gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' }
        }
        const up = (event: PointerEvent) => {
          const current = gesture
          if (!current || current.id !== event.pointerId) return
          gesture = null
          // Let ProseMirror finish the native drag/cell selection before reading its ranges.
          pending = setTimeout(() => {
            if (editor.isDestroyed || view.composing || !formatPainterState(view.state)) return
            if (current.touch && view.state.selection.empty && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) return
            applyFormatPainter(editor)
          }, 0)
        }
        const key = (event: KeyboardEvent) => {
          if (!formatPainterState(view.state) || event.isComposing || event.keyCode === 229 || view.composing) return
          if (event.metaKey || event.ctrlKey || event.altKey) return
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
          else if (event.key === 'Enter' && view.dom.contains(event.target as Node)) {
            event.preventDefault(); event.stopPropagation(); stop(); applyFormatPainter(editor)
          }
        }
        owner.addEventListener('pointerdown', down, true)
        owner.addEventListener('pointerup', up, true)
        owner.addEventListener('pointercancel', stop, true)
        owner.addEventListener('keydown', key, true)
        owner.addEventListener('compositionstart', cancel, true)
        owner.defaultView?.addEventListener('blur', cancel)
        return { destroy() {
          stop()
          owner.removeEventListener('pointerdown', down, true)
          owner.removeEventListener('pointerup', up, true)
          owner.removeEventListener('pointercancel', stop, true)
          owner.removeEventListener('keydown', key, true)
          owner.removeEventListener('compositionstart', cancel, true)
          owner.defaultView?.removeEventListener('blur', cancel)
        } }
      },
    })]
  },
})
