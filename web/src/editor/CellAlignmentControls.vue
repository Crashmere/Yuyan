<script setup lang="ts">
import { computed } from 'vue'
import { TextAlignCenter, TextAlignEnd, TextAlignStart } from 'lucide-vue-next'
import type { Alignment } from '../schema/alignment'
import { alignmentTargets, setAlignment } from './alignment'
import { useEditorContext } from './context'

defineProps<{ compact?: boolean }>()
const { editor, tick } = useEditorContext()
const choices = [
  { value: 'left', label: '单元格内容左对齐', icon: TextAlignStart },
  { value: 'center', label: '单元格内容居中', icon: TextAlignCenter },
  { value: 'right', label: '单元格内容右对齐', icon: TextAlignEnd },
] as const
// Only the cells touched by the current caret/selection; column defaults stay untouched.
const target = computed(() => {
  void tick.value
  const content = editor.value ? alignmentTargets(editor.value).content : null
  return content?.kind === 'cell' ? content : null
})

function pick(value: Alignment) {
  if (editor.value) setAlignment(editor.value, 'cell', value)
}
</script>

<template>
  <template v-if="editor && target">
    <span :class="compact ? 'yy-bubble-sep' : 'yy-toolbar-sep'"></span>
    <button
      v-for="c in choices"
      :key="c.value"
      type="button"
      :class="[compact ? 'yy-bubble-btn' : 'yy-icon-btn', { active: target.current === c.value }]"
      :aria-label="c.label"
      :aria-pressed="target.current === c.value"
      :data-tip="c.label"
      @mousedown.prevent
      @click="pick(c.value)"
    >
      <component :is="c.icon" :size="17" />
    </button>
  </template>
</template>
