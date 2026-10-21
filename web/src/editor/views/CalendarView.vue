<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { closeHistory } from '@tiptap/pm/history'
import CalendarPanel from '../../calendar/CalendarPanel.vue'
import type { CalendarData } from '../../schema/calendar'
import { registerPendingBlock } from '../pendingBlocks'

const props = defineProps(nodeViewProps)
const panel = ref<InstanceType<typeof CalendarPanel>>()
const model = computed(() => props.node.attrs as CalendarData)
function change(value: CalendarData) {
  const pos = props.getPos()
  if (pos === undefined || props.editor.isDestroyed) return
  props.editor.view.dispatch(closeHistory(props.editor.state.tr).setNodeMarkup(pos, undefined, value))
  props.editor.view.dispatch(closeHistory(props.editor.state.tr).setMeta('addToHistory', false))
}
const unregister = registerPendingBlock(props.editor, {
  dirty: () => panel.value?.isDirty() ?? false,
  flush: () => panel.value?.flush() ?? Promise.resolve(true),
})
onBeforeUnmount(unregister)
</script>
<template>
  <NodeViewWrapper contenteditable="false" class="yy-calendar-node" :class="{ 'ProseMirror-selectednode': selected }" @mousedown.stop @keydown.stop>
    <CalendarPanel ref="panel" :model="model" :selected="selected" @change="change" @undo="redo => redo ? editor.commands.redo() : editor.commands.undo()" />
  </NodeViewWrapper>
</template>
