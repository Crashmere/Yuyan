<script setup lang="ts">
import { computed } from 'vue'
import IconButton from '../ui/IconButton.vue'
import { useEditorContext } from './context'
import { captureFormat, formatPainterState, toggleFormatPainter } from './formatPainter'
import FormatIcon from './FormatIcon.vue'
import { withKey } from './keys'

const { editor, tick } = useEditorContext()
const state = computed(() => {
  void tick.value
  const e = editor.value, active = e && formatPainterState(e.state)
  return { active, disabled: !e?.isEditable || (!active && !captureFormat(e.state)) }
})
const label = computed(() => withKey(state.value.active
  ? `格式刷${state.value.active.persistent ? '（连续使用）' : ''}：选择文字或点击段落应用，Esc 退出`
  : '格式刷（单击使用一次，双击连续使用）', 'Mod-Shift-S'))
function click(event: MouseEvent) {
  if (editor.value) toggleFormatPainter(editor.value, event.detail === 2)
}
</script>

<template>
  <IconButton data-format-painter :label="label" aria-label="格式刷" :active="!!state.active" :aria-pressed="!!state.active" :data-mode="state.active ? state.active.persistent ? 'persistent' : 'single' : undefined" :disabled="state.disabled" @mousedown.prevent @click="click" @dblclick.prevent>
    <FormatIcon kind="brush" />
  </IconButton>
</template>
