<script setup lang="ts">
import { Layers } from 'lucide-vue-next'
import { useEditorContext } from './context'

// Saves the current selection as a content snippet. Shared by the toolbars that carry the
// generic selection actions (text, table cell selections, image selections); pair with
// RemoveSelectionButton at a toolbar's far right.
const { ui } = useEditorContext()
</script>

<template>
  <button type="button" class="yy-bubble-btn" data-tip="保存为内容片段" aria-label="保存为内容片段" @mousedown.prevent @click="ui.saveSnippet()"><Layers :size="16" /></button>
</template>
