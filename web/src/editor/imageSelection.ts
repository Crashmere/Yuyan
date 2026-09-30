import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, Selection, SelectionRange, type SelectionBookmark } from '@tiptap/pm/state'
import type { Mappable } from '@tiptap/pm/transform'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

function plainImage(doc: PMNode, pos: number): boolean {
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size || doc.nodeAt(pos)?.type.name !== 'image') return false
  const $pos = doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'imageBoard') return false
  return true
}

// Each range is one image, so existing batch tools and deletion never include text or unpicked
// images between the clicks. The selection belongs to ProseMirror, including undo bookmarks.
export class ImageSelection extends Selection {
  readonly visible = false

  private constructor(doc: PMNode, readonly positions: readonly number[], anchor: number, head: number) {
    super(doc.resolve(anchor), doc.resolve(head), positions.map(pos => new SelectionRange(doc.resolve(pos), doc.resolve(pos + doc.nodeAt(pos)!.nodeSize))))
  }

  static create(doc: PMNode, positions: readonly number[], anchor = positions[0] ?? 0, head = positions.at(-1) ?? anchor): Selection {
    const valid = [...new Set(positions)].filter(pos => plainImage(doc, pos)).sort((a, b) => a - b)
    if (!valid.length) return Selection.near(doc.resolve(Math.max(0, Math.min(anchor, doc.content.size))))
    if (valid.length === 1) return NodeSelection.create(doc, valid[0])
    return new ImageSelection(doc, valid, valid.includes(anchor) ? anchor : valid[0], valid.includes(head) ? head : valid.at(-1)!)
  }

  eq(other: Selection): boolean {
    return other instanceof ImageSelection && other.anchor === this.anchor && other.head === this.head && other.positions.length === this.positions.length && this.positions.every((pos, i) => pos === other.positions[i])
  }

  map(doc: PMNode, mapping: Mappable): Selection { return this.getBookmark().map(mapping).resolve(doc) }

  content(): Slice {
    return new Slice(Fragment.fromArray(this.positions.map(pos => this.$anchor.doc.nodeAt(pos)!)), 0, 0)
  }

  toJSON() { return { type: 'yuyan-images', positions: this.positions, anchor: this.anchor, head: this.head } }
  static fromJSON(doc: PMNode, json: { positions: number[]; anchor: number; head: number }): Selection {
    return ImageSelection.create(doc, json.positions, json.anchor, json.head)
  }
  getBookmark(): SelectionBookmark { return new ImageBookmark(this.positions, this.anchor, this.head) }
}

class ImageBookmark implements SelectionBookmark {
  constructor(readonly positions: readonly number[], readonly anchor: number, readonly head: number) {}
  map(mapping: Mappable): ImageBookmark {
    const positions = this.positions.flatMap(pos => {
      const mapped = mapping.mapResult(pos)
      return mapped.deleted ? [] : [mapped.pos]
    })
    return new ImageBookmark(positions, mapping.map(this.anchor), mapping.map(this.head))
  }
  resolve(doc: PMNode): Selection { return ImageSelection.create(doc, this.positions, this.anchor, this.head) }
}

Selection.jsonID('yuyan-images', ImageSelection)

export function selectImage(view: EditorView, pos: number, event: MouseEvent): boolean {
  if (!view.editable || view.composing || event.button !== 0 || event.altKey || !(event.shiftKey || event.metaKey || event.ctrlKey) || !plainImage(view.state.doc, pos)) return false
  const { doc, selection } = view.state
  const positions = selection instanceof ImageSelection ? [...selection.positions]
    : selection instanceof NodeSelection && plainImage(doc, selection.from) ? [selection.from] : []
  const anchor = positions.length ? selection.anchor : pos
  let next: number[]
  if (event.shiftKey) {
    next = []
    doc.nodesBetween(Math.min(anchor, pos), Math.max(anchor, pos) + 1, (node, at) => {
      if (node.type.name === 'imageBoard') return false
      if (node.type.name === 'image') next.push(at)
    })
    if (event.metaKey || event.ctrlKey) next.push(...positions)
  } else {
    next = positions.includes(pos) ? positions.filter(at => at !== pos) : [...positions, pos]
  }
  event.preventDefault()
  event.stopPropagation()
  view.dispatch(view.state.tr.setSelection(ImageSelection.create(doc, next, anchor, pos)))
  view.focus()
  return true
}

export const ImageMultiSelect = Extension.create({
  name: 'imageMultiSelect',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        // Dialog accessibility changes can make the DOM observer read the native range again.
        // Its two endpoints cannot encode the gaps between images; retain the model selection
        // when those endpoints still match. Real clicks/drags produce different endpoints.
        createSelectionBetween(view, $anchor, $head) {
          const selection = view.state.selection
          return selection instanceof ImageSelection && selection.$anchor.doc === $anchor.doc && selection.anchor === $anchor.pos && selection.head === $head.pos ? selection : null
        },
        decorations(state) {
          const selection = state.selection
          return selection instanceof ImageSelection ? DecorationSet.create(state.doc, selection.positions.map(pos =>
            Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, { class: 'yy-image-multiselected' }),
          )) : null
        },
        handleKeyDown(view, event) {
          const selection = view.state.selection
          if (!(selection instanceof ImageSelection) || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
          if (!['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false
          const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          const pos = backward ? selection.positions[0] : selection.positions.at(-1)! + 1
          event.preventDefault()
          event.stopPropagation()
          view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos), backward ? -1 : 1)))
          return true
        },
      },
    })]
  },
})
