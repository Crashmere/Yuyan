<script setup lang="ts">
import { computed } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { NodeSelection } from '@tiptap/pm/state'
import { Check } from 'lucide-vue-next'
import { blockColor, blockColors } from '../schema/blockContainers'
import { activeHighlight } from './blockContainers'
import { useEditorContext } from './context'
import { commitSelectionChange } from './selectionContent'
import FloatingToolbar from './FloatingToolbar.vue'

// The highlight block's own palette, floating above the block while the caret (or the
// block's node selection) is inside it. Picking a color sets the block background; text
// selected inside the block instead shows the shared text toolbar.
const props = defineProps<{ hidden: boolean }>()
const { editor, tick } = useEditorContext()
const target = computed(() => {
  void tick.value
  const e = editor.value
  if (!e?.isEditable || props.hidden) return null
  return activeHighlight(e.state)
})

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const focused = view.hasFocus() || element.contains(document.activeElement)
  const selection = e.state.selection
  return !props.hidden && focused && e.isEditable && (selection.empty || selection instanceof NodeSelection) && !!activeHighlight(e.state)
}

function anchor() {
  const e = editor.value
  const active = e ? activeHighlight(e.state) : null
  const el = active && e ? e.view.nodeDOM(active.pos) : null
  return el instanceof HTMLElement ? { getBoundingClientRect: () => el.getBoundingClientRect(), contextElement: el } : null
}

function choose(value: string) {
  const e = editor.value, active = target.value
  if (e && active && active.node.attrs.backgroundColor !== value) commitSelectionChange(e, e.state.tr.setNodeMarkup(active.pos, undefined, { ...active.node.attrs, backgroundColor: value }))
}
</script>

<template>
  <FloatingToolbar v-if="target" name="highlightMenu" label="高亮块背景色" :hidden="hidden" :should-show="shouldShow" :anchor="anchor" class="yy-block-palette">
    <button v-for="color in blockColors" :key="color.value" type="button" :aria-label="color.label" :aria-pressed="blockColor(target.node.attrs.backgroundColor).value === color.value" :data-tip="color.label" :style="{ backgroundColor: color.swatch }" @mousedown.prevent @click="choose(color.value)">
      <Check v-if="blockColor(target.node.attrs.backgroundColor).value === color.value" :size="19" :stroke-width="2" />
    </button>
  </FloatingToolbar>
</template>
