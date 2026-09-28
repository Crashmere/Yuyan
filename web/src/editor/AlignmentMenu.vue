<script setup lang="ts">
import { computed } from 'vue'
import { TextAlignCenter, TextAlignEnd, TextAlignStart } from 'lucide-vue-next'
import ActionMenu from '../ui/ActionMenu.vue'
import IconButton from '../ui/IconButton.vue'
import type { MenuEntry } from '../ui/menu'
import type { Alignment } from '../schema/alignment'
import { alignmentTargets, setAlignment, type AlignmentTarget } from './alignment'
import { useEditorContext } from './context'

const { editor, tick } = useEditorContext()
const choices = [
  { value: 'left', label: '左对齐', icon: TextAlignStart },
  { value: 'center', label: '居中', icon: TextAlignCenter },
  { value: 'right', label: '右对齐', icon: TextAlignEnd },
] as const
const targets = computed(() => {
  void tick.value
  return editor.value ? alignmentTargets(editor.value) : { content: null, images: null, table: null }
})
const current = computed(() => targets.value.content ?? targets.value.images ?? targets.value.table)
const combined = computed(() => {
  const { images, content } = targets.value
  if (images && content) return images.current === content.current ? images.current : null
  return current.value?.current
})
const icon = computed(() => choices.find((c) => c.value === combined.value)?.icon ?? TextAlignStart)
const names = { paragraph: '段落', image: '图片', cell: '单元格内容', table: '表格位置' }
function itemsFor(t: AlignmentTarget): MenuEntry[] {
  return choices.map((c) => ({
    label: `${names[t.kind]}${c.label}`,
    icon: c.icon,
    checked: t.current === c.value,
    run: () => { if (editor.value) setAlignment(editor.value, t.kind, c.value as Alignment) },
  }))
}
const items = computed<MenuEntry[]>(() => [
  ...(targets.value.content && targets.value.images ? [
    ...choices.map(c => ({ label: `选中内容${c.label}`, icon: c.icon, checked: combined.value === c.value, run: () => { if (editor.value) setAlignment(editor.value, 'selection', c.value) } })),
    null,
  ] : []),
  ...(targets.value.content ? itemsFor(targets.value.content) : []),
  ...(targets.value.content && targets.value.images ? [null] : []),
  ...(targets.value.images ? itemsFor(targets.value.images) : []),
  ...((targets.value.content || targets.value.images) && targets.value.table ? [null] : []),
  ...(targets.value.table ? itemsFor(targets.value.table) : []),
])
</script>

<template>
  <ActionMenu :items="items" align="start" :restore-focus="false">
    <IconButton label="对齐" :disabled="!current" @mousedown.prevent><component :is="icon" :size="17" /></IconButton>
  </ActionMenu>
</template>
