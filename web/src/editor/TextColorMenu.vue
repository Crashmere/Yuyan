<script setup lang="ts">
import { computed } from 'vue'
import { closeHistory } from '@tiptap/pm/history'
import { useEditorContext } from './context'
import { setSelectedTextMark } from './textSelection'
import ColorPicker from './ColorPicker.vue'

defineProps<{ compact?: boolean }>()
const { editor, tick } = useEditorContext()
const state = computed(() => {
  void tick.value
  const e = editor.value
  return { disabled: !e || e.isActive('codeBlock') || e.isActive('inlineMath') || e.isActive('blockMath'), color: e?.getAttributes('textColor').color ?? null }
})
function apply(color: string | null) {
  const e = editor.value
  if (!e || state.value.disabled) return
  if (setSelectedTextMark(e, 'textColor', color ? { color } : null)) { e.commands.focus(); return }
  const chain = e.chain().focus().command(({ tr }) => { closeHistory(tr); return true })
  if (color) chain.setMark('textColor', { color }).run()
  else chain.unsetMark('textColor').run()
  e.view.dispatch(closeHistory(e.state.tr))
}
</script>

<template><ColorPicker kind="text" :compact="compact" :value="state.color" :disabled="state.disabled" @pick="apply" /></template>
