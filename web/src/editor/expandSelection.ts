import { Extension } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'
import { AllSelection, NodeSelection, Plugin, type Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { altLetter } from '../shared/keyboard'
import { growsRange, textRanges } from '../shared/selectionRange'
import { codeEditorIn } from '../code/editor'
import { codeSelectionRanges } from '../code/expandSelection'
import { headingSections } from './sections'
import { SectionSelection } from './sectionSelection'

function bounds(selection: Selection) {
  // Cell/image selections can have several disjoint ranges; expansion must contain them all.
  return {
    from: Math.min(...selection.ranges.map(range => range.$from.pos)),
    to: Math.max(...selection.ranges.map(range => range.$to.pos)),
  }
}

function hiddenAncestor(pos: ResolvedPos): number | undefined {
  for (let depth = 1; depth <= pos.depth; depth++) {
    const node = pos.node(depth)
    if (node.type.name === 'codeBlock' && node.attrs.collapsed) return depth
    if (((node.type.name === 'foldBlock' && node.attrs.collapsed) || (node.type.name === 'callout' && node.attrs.fold === '-'))
      && pos.pos > pos.start(depth) + node.firstChild!.nodeSize) return depth
  }
}

function cellAt(pos: ResolvedPos): number | undefined {
  for (let depth = pos.depth; depth > 0; depth--) {
    if (['cell', 'header_cell'].includes(pos.node(depth).type.spec.tableRole)) return pos.before(depth)
  }
}

function usable(selection: Selection): boolean {
  if (hiddenAncestor(selection.$from) !== undefined || hiddenAncestor(selection.$to) !== undefined) return false
  // The table plugin collapses a text range ending at the start of a different (often empty)
  // cell. Use its cell selection or the enclosing block instead, before that normalization.
  return !(selection instanceof TextSelection && selection.$to.parentOffset === 0 && cellAt(selection.$from) !== cellAt(selection.$to))
}

function nextSelection(view: EditorView, selection: Selection): Selection | undefined {
  const { doc } = view.state
  if (selection instanceof AllSelection) return
  const current = bounds(selection)
  const $from = doc.resolve(current.from), $to = doc.resolve(current.to)
  const candidates: Selection[] = []
  const add = (candidate: Selection) => {
    if (usable(candidate) && growsRange(bounds(candidate), current)) candidates.push(candidate)
  }
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    const parent = $from.parent, start = $from.start()
    // One placeholder per inline atom keeps the text indices aligned with document positions.
    const text = parent.textBetween(0, parent.content.size, '', '\ufffc')
    const local = { from: current.from - start, to: current.to - start }
    const dom = parent.type.name === 'codeBlock' ? view.nodeDOM($from.before()) : null
    const code = dom instanceof Element ? codeEditorIn(dom) : undefined
    const ranges = code ? codeSelectionRanges(code.view.state, local) : textRanges(text, local)
    for (const range of ranges) {
      add(TextSelection.create(doc, start + range.from, start + range.to))
    }
  }
  for (let depth = $from.sharedDepth(current.to); depth > 0; depth--) {
    const parent = $from.node(depth)
    const pos = $from.before(depth), role = parent.type.spec.tableRole
    // Cell -> table, with no intervening row or cross-cell text selection.
    if (role === 'row') continue
    // Selecting all cell text and selecting the table are different operations, even for
    // a single cell. Always offer the table plugin's canonical whole-table selection.
    if (role === 'table') {
      const map = TableMap.get(parent), start = pos + 1
      add(CellSelection.create(doc, start + map.map[0], start + map.map.at(-1)!))
      continue
    }
    const content = TextSelection.between(doc.resolve($from.start(depth)), doc.resolve($from.end(depth)))
    add(content)
    if (role === 'cell' || role === 'header_cell') {
      add(CellSelection.create(doc, pos))
      continue
    }
    // TextSelection.between skips edge atoms. Select the enclosing node when that would leave
    // part of the original image/block selection out; ordinary text avoids redundant steps.
    if ((content.from > current.from || content.to < current.to || !usable(content))
      && NodeSelection.isSelectable(parent)) {
      add(NodeSelection.create(doc, pos))
    }
  }
  for (const section of headingSections(doc)) {
    // Body first; when the selection already includes the heading, keep that heading too.
    const from = current.from < section.body ? section.pos : section.body
    if (from >= section.end || from > current.from || section.end < current.to) continue
    const text = TextSelection.between(doc.resolve(from), doc.resolve(section.end))
    if (selection instanceof TextSelection && text.from === current.from && text.to === current.to) continue
    add(SectionSelection.create(doc, from, section.end))
  }
  candidates.push(new AllSelection(doc))
  return candidates.sort((a, b) => {
    const left = bounds(a), right = bounds(b)
    return (left.to - left.from) - (right.to - right.from)
  })[0]
}

export function expandSelection(view: EditorView): boolean {
  const { state } = view, { selection } = state
  const next = nextSelection(view, selection)
  if (next) {
    const directed = next instanceof TextSelection && selection.anchor > selection.head
      ? TextSelection.create(state.doc, next.to, next.from) : next
    if (!directed.eq(selection)) view.dispatch(state.tr.setSelection(directed).scrollIntoView())
  }
  return true
}

export const ExpandSelection = Extension.create({
  name: 'expandSelection',
  priority: 1000,
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        createSelectionBetween(view, anchor, head) {
          const current = view.state.selection
          return current instanceof SectionSelection && current.anchor === anchor.pos && current.head === head.pos ? current : null
        },
        handleKeyDown(view, event) {
          if (!view.editable || view.composing || !altLetter(event, 'l')) return false
          return expandSelection(view)
        },
      },
    })]
  },
})
