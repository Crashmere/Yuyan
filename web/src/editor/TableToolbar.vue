<script setup lang="ts">
import { computed } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, TextAlignCenter, TextAlignEnd, TextAlignStart, Trash2 } from 'lucide-vue-next'
import { useEditorContext } from './context'
import { columnAlign, runTable, setColumnAlign, tableElement, type Align, type TableCommand } from './tables'

// Shown above the table while the cursor is in it. When the top of a long table has scrolled
// under the toolbar, the bar stays in view just below it.
const { editor, tick } = useEditorContext()

const inserts: { command: TableCommand; label: string; icon: unknown }[] = [
  { command: 'addRowBefore', label: '在上方插入行', icon: BetweenHorizontalStart },
  { command: 'addRowAfter', label: '在下方插入行', icon: BetweenHorizontalEnd },
  { command: 'addColumnBefore', label: '在左侧插入列', icon: BetweenVerticalStart },
  { command: 'addColumnAfter', label: '在右侧插入列', icon: BetweenVerticalEnd },
]
const aligns: { align: Exclude<Align, null>; label: string; icon: unknown }[] = [
  { align: 'left', label: '整列左对齐', icon: TextAlignStart },
  { align: 'center', label: '整列居中', icon: TextAlignCenter },
  { align: 'right', label: '整列右对齐', icon: TextAlignEnd },
]

const current = computed(() => {
  void tick.value
  return editor.value ? columnAlign(editor.value) : null
})

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const focused = view.hasFocus() || element.contains(document.activeElement)
  return focused && e.isEditable && e.isActive('table')
}

function anchor() {
  const e = editor.value
  const table = e && tableElement(e)
  if (!table) return null
  return {
    contextElement: table,
    getBoundingClientRect() {
      const r = table.getBoundingClientRect()
      const floor = (document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0) + 44
      const top = Math.min(Math.max(r.top, floor), r.bottom)
      return new DOMRect(r.left, top, r.width, r.bottom - top)
    },
  }
}

// Clicking "left" on a left-aligned column clears the alignment again.
function align(value: Exclude<Align, null>) {
  if (editor.value) setColumnAlign(editor.value, current.value === value ? null : value)
}
</script>

<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    plugin-key="tableMenu"
    :should-show="shouldShow"
    :get-referenced-virtual-element="anchor"
    :options="{ placement: 'top-start', offset: 8, flip: false }"
    class="yy-bubble yy-table-toolbar"
  >
    <button v-for="i in inserts" :key="i.command" type="button" class="yy-bubble-btn" :title="i.label" :aria-label="i.label" @mousedown.prevent @click="runTable(editor, i.command)">
      <component :is="i.icon" :size="16" />
    </button>
    <span class="yy-bubble-sep"></span>
    <button
      v-for="a in aligns"
      :key="a.align"
      type="button"
      class="yy-bubble-btn"
      :class="{ active: current === a.align }"
      :title="a.label"
      :aria-label="a.label"
      :aria-pressed="current === a.align"
      @mousedown.prevent
      @click="align(a.align)"
    >
      <component :is="a.icon" :size="16" />
    </button>
    <span class="yy-bubble-sep"></span>
    <button type="button" class="yy-bubble-text" @mousedown.prevent @click="runTable(editor, 'deleteRow')">删除行</button>
    <button type="button" class="yy-bubble-text" @mousedown.prevent @click="runTable(editor, 'deleteColumn')">删除列</button>
    <button type="button" class="yy-bubble-btn danger" title="删除表格" aria-label="删除表格" @mousedown.prevent @click="runTable(editor, 'deleteTable')">
      <Trash2 :size="16" />
    </button>
  </BubbleMenu>
</template>
