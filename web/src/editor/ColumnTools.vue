<script setup lang="ts">
import { computed } from 'vue'
import { Columns2 } from 'lucide-vue-next'
import ActionMenu from '../ui/ActionMenu.vue'
import type { MenuEntry } from '../ui/menu'
import { useEditorContext } from './context'
import { activeColumns, moveColumn, setColumnCount, setColumnWidths, unwrapColumns } from './columns'

const { editor, tick } = useEditorContext()
const active = computed(() => { void tick.value; return editor.value ? activeColumns(editor.value.state) : null })
const items = computed<MenuEntry[]>(() => {
  const e = editor.value, a = active.value
  if (!e || !a) return []
  return [
    ...[2, 3, 4].map(count => ({ label: `${count} 栏`, checked: a.node.childCount === count, run: () => setColumnCount(e, count) })),
    null,
    { label: '等宽分栏', checked: !a.node.attrs.widths, run: () => setColumnWidths(e, null) },
    ...(a.node.childCount === 2 ? [
      { label: '左窄右宽', run: () => setColumnWidths(e, [1, 2]) },
      { label: '左宽右窄', run: () => setColumnWidths(e, [2, 1]) },
    ] : []),
    null,
    { label: '当前栏向前移', disabled: a.index === 0, run: () => moveColumn(e, -1) },
    { label: '当前栏向后移', disabled: a.index === a.node.childCount - 1, run: () => moveColumn(e, 1) },
    null,
    { label: '取消分栏，保留内容', run: () => unwrapColumns(e) },
  ]
})
</script>

<template>
  <template v-if="active">
    <span class="yy-toolbar-sep"></span>
    <ActionMenu :items="items" :restore-focus="false">
      <button type="button" class="yy-icon-btn" aria-label="分栏设置" data-tip="分栏设置" @mousedown.prevent><Columns2 :size="17" /></button>
    </ActionMenu>
  </template>
</template>
