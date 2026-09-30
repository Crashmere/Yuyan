<script setup lang="ts">
import { computed } from 'vue'
import { useEditorContext } from './context'
import { applyTextColors, selectedTextColor } from './textColors'
import { colorMemory } from './colorPreferences'
import ColorPicker from './ColorPicker.vue'

defineProps<{ compact?: boolean }>()
const { editor, tick } = useEditorContext()
const state = computed(() => {
  void tick.value
  const e = editor.value
  return { disabled: !e || e.isActive('codeBlock') || e.isActive('inlineMath') || e.isActive('blockMath'), text: e ? selectedTextColor(e) : { value: null, mixed: false }, background: e ? selectedTextColor(e, true) : { value: null, mixed: false } }
})
function apply(values: { text?: string | null; highlight?: string | null }) {
  const e = editor.value
  if (e && !state.value.disabled) applyTextColors(e, values)
}
</script>

<template>
  <ColorPicker v-if="compact" kind="combined" compact :value="state.text.value" :background="state.background.value" :mixed="state.text.mixed" :background-mixed="state.background.mixed" :disabled="state.disabled" @pick="text => apply({ text })" @background="highlight => apply({ highlight })" @reset="apply({ text: null, highlight: null })" @repeat="apply({ text: colorMemory.text.last, highlight: colorMemory.highlight.last })" />
  <template v-else>
    <ColorPicker kind="text" :value="state.text.value" :mixed="state.text.mixed" :disabled="state.disabled" @pick="text => apply({ text })" />
    <ColorPicker kind="highlight" :value="state.background.value" :mixed="state.background.mixed" :disabled="state.disabled" @pick="highlight => apply({ highlight })" />
  </template>
</template>
