import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { scrollToPosition } from '../shared/scroll'

interface PendingSpace { pos: number; node: PMNode }
const spacesKey = new PluginKey<PendingSpace[]>('blockSpaces')

// Uploads use decorations before their real content arrives. Starting one makes this an
// intentional insertion, so leaving the paragraph must not remove its upload destination.
export function keepBlockSpace(tr: Transaction, pos: number): Transaction {
  return tr.setMeta(spacesKey, { keep: pos })
}

function cleanup(state: EditorState, leaving = false): Transaction | null {
  const pending = spacesKey.getState(state) ?? []
  const unused = pending.filter(({ pos }) => leaving || !state.selection.ranges.some(({ $from, $to }) => $from.pos <= pos + 1 && $to.pos >= pos + 1))
  if (!unused.length) return null
  const tr = state.tr
  for (const { pos, node } of unused.sort((a, b) => b.pos - a.pos)) {
    const $pos = tr.doc.resolve(pos)
    if (tr.doc.nodeAt(pos) === node && $pos.parent.canReplace($pos.index(), $pos.index() + 1)) tr.delete(pos, pos + node.nodeSize)
  }
  // Cleanup must never resurrect an accidental blank line when the next edit is undone.
  return tr.docChanged ? tr.setMeta('addToHistory', false) : null
}

export function clearUnusedBlockSpaces(view: EditorView) {
  if (view.isDestroyed || view.composing) return
  const tr = cleanup(view.state, true)
  if (tr) view.dispatch(tr)
}

function needsSpace(node: PMNode): boolean {
  if (['calendar', 'attachment', 'table', 'horizontalRule', 'codeBlock', 'blockMath', 'callout', 'imageBoard', 'foldBlock', 'highlightBlock', 'columns'].includes(node.type.name)) return true
  if (!node.isTextblock || !node.childCount) return false
  let image = false, other = false
  node.forEach((child) => {
    if (child.type.name === 'image') image = true
    else if (child.type.name !== 'hardBreak') other = true
  })
  return image && !other
}

function elementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos)
  return dom instanceof HTMLElement ? dom : null
}

function canClickSpace(view: EditorView, event: MouseEvent): boolean {
  return view.editable && !view.composing && !event.defaultPrevented && event.button === 0 && event.detail <= 1
    && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
}

function enterSpace(view: EditorView, event: MouseEvent, pos: number, empty: number | null): boolean {
  let tr = view.state.tr
  if (empty === null) tr = closeHistory(tr.insert(pos, view.state.schema.nodes.paragraph.create()).setMeta(spacesKey, { add: pos }))
  tr.setSelection(TextSelection.create(tr.doc, empty ?? pos + 1))
  event.preventDefault()
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

function clickDocumentEnd(view: EditorView, event: MouseEvent): boolean {
  if (!canClickSpace(view, event)) return false
  // Short documents leave space inside ProseMirror; the page's bottom padding belongs to
  // the surrounding main column. Only these blank surfaces should append to the document.
  const target = event.target
  if (target !== view.dom && target !== view.dom.parentElement && target !== view.dom.closest('.yy-editor-main')) return false
  const box = view.dom.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right) return false
  let last = view.dom.lastElementChild
  while (last && !last.getClientRects().length) last = last.previousElementSibling
  if (!last || event.clientY <= last.getBoundingClientRect().bottom) return false
  const { doc, schema } = view.state
  const end = doc.content.size
  const node = doc.lastChild
  const empty = node?.type.name === 'paragraph' && !node.content.size ? end - node.nodeSize + 1 : null
  if (empty === null && !doc.canReplaceWith(doc.childCount, doc.childCount, schema.nodes.paragraph)) return false
  enterSpace(view, event, end, empty)
  // A padding click can start with focus in the title and the new caret offscreen.
  // ProseMirror's scroll request then has no DOM selection yet; check after focus,
  // also keeping the caret below the sticky toolbar rather than behind it.
  const caret = view.coordsAtPos(view.state.selection.head)
  const owner = view.dom.ownerDocument
  const scroller = owner.scrollingElement as HTMLElement | null
  const toolbar = view.dom.closest('.yy-editor-pane')?.querySelector('.yy-toolbar')
  const top = Math.max(0, toolbar?.getBoundingClientRect().bottom ?? 0) + 16
  const bottom = owner.documentElement.clientHeight - 16
  const offset = caret.top < top ? caret.top - top : caret.bottom > bottom ? caret.bottom - bottom : 0
  if (scroller && offset) scrollToPosition(scroller, { top: scroller.scrollTop + offset })
  return true
}

// Use the actual gaps between sibling blocks, including inside lists/callouts/cells. No hidden
// paragraphs or document decorations are needed until the user clicks to insert one.
export const BlockSpaces = Extension.create({
  name: 'blockSpaces',
  // Resizing and node-specific controls get first refusal on their own hit areas.
  priority: 50,
  addProseMirrorPlugins() {
    let editorView: EditorView | undefined
    return [new Plugin<PendingSpace[]>({
      key: spacesKey,
      state: {
        init: () => [],
        apply(tr, pending) {
          const meta = tr.getMeta(spacesKey) as { add?: number; keep?: number } | undefined
          const next: PendingSpace[] = []
          for (const space of pending) {
            let pos = space.pos, touched = false
            for (const map of tr.mapping.maps) {
              map.forEach((from, to) => { if (from <= pos + 1 && to >= pos + 1) touched = true })
              const mapped = map.mapResult(pos, 1)
              touched ||= mapped.deleted; pos = mapped.pos
            }
            // Unchanged nodes retain their identity. Typing, splitting, changing block styles,
            // or replacing/moving a container makes the paragraph intentional, even if empty.
            if (touched || tr.doc.nodeAt(pos) !== space.node || meta?.keep === pos + 1) continue
            if (tr.storedMarksSet && tr.storedMarks && tr.selection.from === pos + 1) continue
            next.push({ ...space, pos })
          }
          if (meta?.add !== undefined) next.push({ pos: meta.add, node: tr.doc.nodeAt(meta.add)! })
          return next
        },
      },
      appendTransaction(_transactions, _old, state) { return editorView?.composing ? null : cleanup(state) },
      view(view) {
        editorView = view
        let timer: ReturnType<typeof setTimeout> | undefined
        const schedule = () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            if (view.composing) return
            const active = view.dom.ownerDocument.activeElement
            // Formatting and insertion panels still operate on the current paragraph. Wait
            // for their command or a real departure instead of deleting their saved anchor.
            if (active?.closest('.yy-toolbar, .yy-float, [role="menu"], [role="dialog"]')) return
            const tr = cleanup(view.state, active !== view.dom)
            if (tr) view.dispatch(tr)
          }, 30)
        }
        const doc = view.dom.ownerDocument
        // EditorContent attaches the view after plugin creation, so resolve its column
        // at click time rather than keeping an ancestor from the initial detached DOM.
        const onEndClick = (event: MouseEvent) => clickDocumentEnd(view, event)
        doc.addEventListener('mousedown', onEndClick)
        doc.addEventListener('focusin', schedule)
        doc.addEventListener('pointerup', schedule)
        view.dom.addEventListener('blur', schedule, true)
        view.dom.addEventListener('compositionend', schedule)
        return { destroy() {
          editorView = undefined
          clearTimeout(timer)
          doc.removeEventListener('mousedown', onEndClick)
          doc.removeEventListener('focusin', schedule); doc.removeEventListener('pointerup', schedule)
          view.dom.removeEventListener('blur', schedule, true)
          view.dom.removeEventListener('compositionend', schedule)
        } }
      },
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (!canClickSpace(view, event)) return false
            if (clickDocumentEnd(view, event)) return true
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest('button, input, textarea, .yy-table-bar, .yy-image-handle')) return false
            const rule = target?.closest('hr')
            if (rule && view.dom.contains(rule)) {
              const pos = view.posAtDOM(rule, 0)
              event.preventDefault()
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
              view.focus()
              return true
            }

            const { clientX: x, clientY: y } = event
            type Space = { pos: number; empty: number | null; distance: number }
            let found: Space | null = null
            view.state.doc.descendants((node, pos) => {
              if (!needsSpace(node)) return
              const dom = elementAt(view, pos)
              if (!dom?.getClientRects().length) return
              const box = dom.getBoundingClientRect()
              const parentBox = dom.parentElement!.getBoundingClientRect()
              if (x < parentBox.left || x > parentBox.right) return
              // Visual rows inside one paragraph are handled by the image break guide.
              // Clicking their automatic spacing must never silently split the paragraph.
              const $pos = view.state.doc.resolve(pos)
              const parent = $pos.parent
              const index = $pos.index()
              for (const before of [true, false]) {
                const distance = before ? box.top - y : y - box.bottom
                if (distance < 0 || distance > 28 || (found && distance >= found.distance)) continue
                const at = before ? pos : pos + node.nodeSize
                const sibling = parent.maybeChild(index + (before ? -1 : 1))
                const siblingPos = before ? pos - (sibling?.nodeSize ?? 0) : at
                const siblingDOM = sibling ? elementAt(view, siblingPos) : null
                const siblingBox = siblingDOM?.getBoundingClientRect()
                if (siblingBox && (before ? y < siblingBox.bottom : y > siblingBox.top)) continue
                const empty = sibling?.type.name === 'paragraph' && !sibling.content.size ? siblingPos + 1 : null
                if (empty === null && !parent.canReplaceWith(index + (before ? 0 : 1), index + (before ? 0 : 1), view.state.schema.nodes.paragraph)) continue
                found = { pos: at, empty, distance }
              }
            })
            if (!found) return false
            const { pos, empty } = found as Space
            return enterSpace(view, event, pos, empty)
          },
        },
      },
    })]
  },
})
