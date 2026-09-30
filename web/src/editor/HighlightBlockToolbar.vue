<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NodeSelection } from '@tiptap/pm/state'
import { Check } from 'lucide-vue-next'
import { blockColor, blockColors } from '../schema/blockContainers'
import { activeHighlight } from './blockContainers'
import { useEditorContext } from './context'
import { place } from './floating'
import { commitSelectionChange } from './selectionContent'

const props = defineProps<{ hidden: boolean }>()
const { editor, tick } = useEditorContext()
const panel = ref<HTMLElement | null>(null)
const target = computed(() => {
  void tick.value
  const e = editor.value
  if (!e?.isEditable || !e.isFocused || props.hidden || (!e.state.selection.empty && !(e.state.selection instanceof NodeSelection))) return null
  return activeHighlight(e.state)
})
let stop = () => {}
watch([target, panel], async (_next, _previous, onCleanup) => {
  stop(); stop = () => {}
  let cancelled = false
  onCleanup(() => { cancelled = true; stop() })
  await nextTick()
  if (cancelled) return
  const active = target.value, e = editor.value, el = active && e?.view.nodeDOM(active.pos)
  if (el instanceof HTMLElement && panel.value) stop = place(panel.value, el, 'top')
}, { flush: 'post' })
onBeforeUnmount(() => stop())
function choose(value: string) {
  const e = editor.value, active = target.value
  if (e && active && active.node.attrs.backgroundColor !== value) commitSelectionChange(e, e.state.tr.setNodeMarkup(active.pos, undefined, { ...active.node.attrs, backgroundColor: value }))
}
</script>

<template>
  <Teleport to="body">
    <div v-if="target" ref="panel" class="yy-block-palette yy-float" role="toolbar" aria-label="高亮块背景色" @mousedown.prevent>
      <button v-for="color in blockColors" :key="color.value" type="button" :aria-label="color.label" :aria-pressed="blockColor(target.node.attrs.backgroundColor).value === color.value" :data-tip="color.label" :style="{ backgroundColor: color.swatch }" @click="choose(color.value)">
        <Check v-if="blockColor(target.node.attrs.backgroundColor).value === color.value" :size="19" :stroke-width="2" />
      </button>
    </div>
  </Teleport>
</template>
