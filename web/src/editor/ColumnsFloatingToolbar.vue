<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { useEditorContext } from './context'
import { activeColumns } from './columns'
import { formatPainterState } from './formatPainter'
import FloatingToolbar from './FloatingToolbar.vue'
import ColumnTools from './ColumnTools.vue'

// The columns block's own floating toolbar, anchored above the columns while the caret or
// a selection is inside them. Column count/width/order and ungrouping live only here (and
// in the top toolbar); text inside a column uses the shared text toolbar alongside it.
const props = defineProps<{ hidden: boolean }>()
const { editor } = useEditorContext()

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const focused = view.hasFocus() || element.contains(document.activeElement)
  return !props.hidden && !formatPainterState(e.state) && focused && e.isEditable && !!activeColumns(e.state)
}

function anchor() {
  const e = editor.value
  const active = e ? activeColumns(e.state) : null
  const el = active && e ? e.view.nodeDOM(active.pos) : null
  return el instanceof HTMLElement ? { getBoundingClientRect: () => el.getBoundingClientRect(), contextElement: el } : null
}
</script>

<template>
  <FloatingToolbar name="columnsMenu" label="分栏" :hidden="hidden" :should-show="shouldShow" :anchor="anchor" update-on-tick class="yy-selection-toolbar yy-columns-toolbar">
    <ColumnTools compact standalone />
  </FloatingToolbar>
</template>
