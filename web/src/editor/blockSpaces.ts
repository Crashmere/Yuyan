import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

function needsSpace(node: PMNode): boolean {
  if (['table', 'horizontalRule', 'codeBlock', 'blockMath', 'callout', 'imageBoard'].includes(node.type.name)) return true
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

// Use the actual gaps between sibling blocks, including inside lists/callouts/cells. No hidden
// paragraphs or document decorations are needed until the user clicks to insert one.
export const BlockSpaces = Extension.create({
  name: 'blockSpaces',
  // Resizing and node-specific controls get first refusal on their own hit areas.
  priority: 50,
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (!view.editable || view.composing || event.defaultPrevented || event.button !== 0 || event.detail > 1 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
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
            let tr = view.state.tr
            const insertAt = pos
            if (empty === null) tr = closeHistory(tr.insert(insertAt, view.state.schema.nodes.paragraph.create()))
            tr.setSelection(TextSelection.create(tr.doc, empty ?? insertAt + 1))
            event.preventDefault()
            view.dispatch(tr.scrollIntoView())
            view.focus()
            return true
          },
        },
      },
    })]
  },
})
