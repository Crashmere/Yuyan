<script setup lang="ts">
import { computed } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { useEditorContext } from './context'
import { removalLabel, removeSelection } from './removeSelection'

const { editor, tick } = useEditorContext()
const label = computed(() => {
  void tick.value
  return editor.value ? removalLabel(editor.value) : '移除选中内容'
})
</script>

<template>
  <button v-if="editor" type="button" class="yy-bubble-btn danger yy-remove-selection" :data-tip="label" :aria-label="label" @mousedown.prevent @click="removeSelection(editor)">
    <Trash2 :size="16" />
  </button>
</template>
