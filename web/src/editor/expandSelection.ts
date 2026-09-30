import { Extension } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'
import { AllSelection, NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { altLetter } from '../shared/keyboard'
import { growsRange, smallerRange, textRanges } from '../shared/selectionRange'
import { codeEditorIn } from '../code/editor'
import { codeSelectionRanges } from '../code/expandSelection'

const selectionHistory = new PluginKey<readonly Selection[]>('selectionExpansion')

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
    const content = TextSelection.between(doc.resolve($from.start(depth)), doc.resolve($from.end(depth)))
    add(content)
    // TextSelection.between skips edge atoms. Select the enclosing node when that would leave
    // part of the original image/block selection out; ordinary text avoids redundant steps.
    if ((content.from > current.from || content.to < current.to || !usable(content))
      && NodeSelection.isSelectable(parent)) {
      const pos = $from.before(depth), role = parent.type.spec.tableRole
      // Use the table plugin's canonical selection immediately. Its later normalization of a
      // NodeSelection would otherwise clear our history or repeatedly select the same table.
      if (role === 'table') {
        const map = TableMap.get(parent), start = pos + 1
        add(CellSelection.create(doc, start + map.map[0], start + map.map.at(-1)!))
      } else if (role === 'row') {
        const cell = doc.resolve(pos + 1)
        add(CellSelection.rowSelection(cell, cell))
      } else if (role === 'cell' || role === 'header_cell') add(CellSelection.create(doc, pos))
      else add(NodeSelection.create(doc, pos))
    }
  }
  candidates.push(new AllSelection(doc))
  return candidates.sort((a, b) => {
    const left = bounds(a), right = bounds(b)
    return (left.to - left.from) - (right.to - right.from)
  })[0]
}

export function resizeSelection(view: EditorView, shrink = false): boolean {
  const { state } = view, { doc, selection } = state
  let next: Selection | undefined
  if (shrink) {
    next = selectionHistory.getState(state)?.at(-1)
    if (!next && !selection.empty) {
      const current = bounds(selection)
      let start = Selection.near(doc.resolve(current.from), 1)
      const hidden = hiddenAncestor(start.$from)
      if (hidden !== undefined) start = NodeSelection.create(doc, start.$from.before(hidden))
      next = smallerRange(current, start, range => nextSelection(view, range), bounds)
    }
  } else next = nextSelection(view, selection)
  if (next) {
    const directed = !shrink && next instanceof TextSelection && selection.anchor > selection.head
      ? TextSelection.create(doc, next.to, next.from) : next
    if (!directed.eq(selection)) view.dispatch(state.tr.setSelection(directed).setMeta(selectionHistory, shrink ? 'shrink' : 'expand').scrollIntoView())
  }
  return true
}

export const ExpandSelection = Extension.create({
  name: 'expandSelection',
  priority: 1000,
  addProseMirrorPlugins() {
    return [new Plugin<readonly Selection[]>({
      key: selectionHistory,
      state: {
        init: () => [],
        apply(tr, history, oldState) {
          if (tr.docChanged) return []
          if (tr.getMeta(selectionHistory) === 'expand') return [...history, oldState.selection]
          if (tr.getMeta(selectionHistory) === 'shrink') return history.slice(0, -1)
          return tr.selectionSet && !tr.selection.eq(oldState.selection) ? [] : history
        },
      },
      props: {
        handleKeyDown(view, event) {
          if (!view.editable || view.composing || !altLetter(event, 'l', event.shiftKey)) return false
          return resizeSelection(view, event.shiftKey)
        },
      },
    })]
  },
})
