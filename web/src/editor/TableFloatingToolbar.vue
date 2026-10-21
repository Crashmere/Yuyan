<script setup lang="ts">
import { computed } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { useEditorContext } from './context'
import { formatPainterState } from './formatPainter'
import { ImageSelection } from './imageSelection'
import FloatingToolbar from './FloatingToolbar.vue'
import RemoveSelectionButton from './RemoveSelectionButton.vue'
import SaveSnippetButton from './SaveSnippetButton.vue'
import TableTools from './TableTools.vue'

// The table's own floating toolbar, anchored above the table (or following a lower cell
// selection in a long table). It is separate from the shared text toolbar near selected
// text: table operations live only here (and in the top toolbar), text formatting only
// there, and both can be visible at once when text inside a cell is selected.
const props = defineProps<{ hidden: boolean }>()
const { editor, tick } = useEditorContext()

const cellSelection = computed(() => {
  void tick.value
  return editor.value?.state.selection instanceof CellSelection
})

function inTable(e: Editor): boolean {
  const selection = e.state.selection
  if (selection instanceof CellSelection) return true
  if (selection instanceof NodeSelection) return selection.node.type.name === 'table'
  if (selection instanceof ImageSelection) return false
  return e.isActive('table')
}

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const insideCode = !!document.activeElement?.closest('.ProseMirror .cm-content, .yy-code-dialog .cm-content')
  const focused = view.hasFocus() || element.contains(document.activeElement)
  const selection = e.state.selection
  const image = selection instanceof NodeSelection && ['image', 'imageBoard'].includes(selection.node.type.name)
  return !props.hidden && !formatPainterState(e.state) && focused && !insideCode && e.isEditable && !image && inTable(e)
}

// Keep actions reachable for a column taller/wider than the viewport. Only the menu's anchor
// is clipped; the selection and the table's peripheral controls retain their real geometry.
function anchor() {
  const e = editor.value
  const selection = e?.state.selection
  if (!e || !selection) return null
  let first: HTMLElement | null = null
  let last: HTMLElement | null = null
  let tableEl: HTMLElement | null = null
  const wholeTable = !(selection instanceof CellSelection)
  if (selection instanceof CellSelection) {
    const anchorCell = e.view.nodeDOM(selection.$anchorCell.pos)
    const headCell = e.view.nodeDOM(selection.$headCell.pos)
    first = anchorCell instanceof HTMLElement ? anchorCell : null
    last = headCell instanceof HTMLElement ? headCell : null
    tableEl = first?.closest('table') ?? null
  } else if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    const dom = e.view.nodeDOM(selection.from)
    tableEl = dom instanceof HTMLElement ? (dom.matches('table') ? dom : dom.querySelector('table')) : null
    first = tableEl
    last = tableEl
  } else {
    const caretDOM = e.view.domAtPos(selection.from).node
    const caretCell = (caretDOM instanceof Element ? caretDOM : caretDOM?.parentElement)?.closest('td, th')
    first = caretCell instanceof HTMLElement ? caretCell : null
    last = first
    tableEl = first?.closest('table') ?? null
  }
  if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement) || !(tableEl instanceof HTMLElement)) return null
  return {
    contextElement: wholeTable ? tableEl : first,
    getBoundingClientRect() {
      const a = first.getBoundingClientRect(), b = last.getBoundingClientRect()
      const table = tableEl.getBoundingClientRect()
      const scroll = (first.closest('.yy-table-scroll') ?? tableEl).getBoundingClientRect()
      const toolbar = document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0
      const height = document.querySelector<HTMLElement>('.yy-table-toolbar')?.offsetHeight ?? 38
      // A caret or a text selection uses the table itself. The scroll frame can be much wider
      // than the grid, so centering on it would leave the toolbar away from the table.
      const spanLeft = wholeTable ? table.left : Math.min(a.left, b.left)
      const spanRight = wholeTable ? table.right : Math.max(a.right, b.right)
      const left = Math.max(spanLeft, scroll.left, 8)
      const right = Math.min(spanRight, scroll.right, innerWidth - 8)
      const selectedTop = Math.min(a.top, b.top)
      // Always keep the table toolbar above the whole table, so a lower cell does not cover
      // the rows above it. A cell selection near the header does the same, so it clears the
      // column rail; farther down it follows the selected rows.
      const above = wholeTable || selectedTop - table.top < height + 80 ? table.top : selectedTop
      const floor = toolbar + height + 48
      // If the rail still fits but a menu above it does not, put the menu inside the table.
      // Reserving its height in the rail itself would make the rail disappear much too early.
      const top = above === table.top && above < floor && table.top > toolbar
        ? table.top + height + 48 : Math.max(above, floor)
      const contentBottom = wholeTable ? table.bottom : Math.max(a.bottom, b.bottom)
      const bottom = Math.max(top, Math.min(contentBottom, innerHeight - 8))
      return new DOMRect(left, top, Math.max(0, right - left), bottom - top)
    },
  }
}
</script>

<template>
  <FloatingToolbar name="tableMenu" label="表格" :hidden="hidden" :should-show="shouldShow" :anchor="anchor" :offset="40" update-on-tick class="yy-selection-toolbar yy-table-toolbar">
    <TableTools compact standalone />
    <template v-if="cellSelection">
      <RemoveSelectionButton />
      <SaveSnippetButton />
    </template>
  </FloatingToolbar>
</template>
