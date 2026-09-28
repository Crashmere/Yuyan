<script setup lang="ts">
import { computed, ref } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection } from '@tiptap/pm/state'
import { assetURL } from '../../shared/api'
import { assetId, reservedSize } from '../../shared/images'
import { blockWidth, imageSizes } from '../images'
import { alignment } from '../../schema/alignment'

const props = defineProps(nodeViewProps)

const img = ref<HTMLImageElement | null>(null)
// The width while a corner is being dragged; written to the document on release.
const live = ref<number | null>(null)
const src = computed(() => assetURL(String(props.node.attrs.src ?? '')))
const align = computed(() => alignment(props.node.attrs.blockAlign))
// Display only: the stored size keeps the image's space before it loads; the document is unchanged.
const reserved = computed(() => {
  const id = assetId(src.value)
  return reservedSize(id ? imageSizes(props.editor)[id] : undefined, props.node.attrs.width as number | null, props.node.attrs.height as number | null)
})
const width = computed(() => live.value ?? (props.node.attrs.width as number | null) ?? reserved.value.width)
const height = computed(() => (live.value === null ? ((props.node.attrs.height as number | null) ?? undefined) : undefined))

// Dragging a corner sets the width in pixels and drops any height, keeping the proportions; the
// Markdown export writes it as Obsidian's |width.
function startResize(e: PointerEvent, direction: 1 | -1) {
  const el = img.value
  if (!el || e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const handle = e.currentTarget as HTMLElement
  try {
    handle.setPointerCapture(e.pointerId)
  } catch {
    // no active pointer with this id (synthetic events); moves are still tracked on the handle
  }
  const startX = e.clientX
  const start = el.getBoundingClientRect().width
  const max = blockWidth(el)
  const move = (ev: PointerEvent) => {
    live.value = Math.round(Math.min(max, Math.max(24, start + direction * (ev.clientX - startX))))
  }
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    const w = live.value
    live.value = null
    if (w !== null && w !== Math.round(start)) {
      const pos = props.getPos()
      if (typeof pos !== 'number') return
      const { state, view } = props.editor
      const node = state.doc.nodeAt(pos)
      if (node?.type.name !== 'image') return
      const tr = closeHistory(state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, width: w, height: null })
      // Replacing an inline leaf maps its node selection to a text cursor unless restored.
      // Keep the image selected and its toolbar attached throughout the resize commit.
      if (state.selection instanceof NodeSelection && state.selection.from === pos) tr.setSelection(NodeSelection.create(tr.doc, pos))
      view.dispatch(tr)
    }
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}
</script>

<template>
  <node-view-wrapper as="span" class="yy-image" :class="{ resizing: live !== null, 'is-aligned': !!align, 'ProseMirror-selectednode': selected }" :style="align ? { textAlign: align } : undefined">
    <span class="yy-image-content">
      <img
        ref="img"
        :src="src"
        :alt="node.attrs.alt ?? ''"
        :title="node.attrs.title ?? undefined"
        :width="width"
        :height="height"
        :data-frame="node.attrs.shadow === true ? 'shadow' : undefined"
        :style="reserved.aspectRatio ? { aspectRatio: reserved.aspectRatio } : undefined"
        draggable="true"
        data-drag-handle
      />
      <template v-if="selected && editor.isEditable">
        <span class="yy-image-handle left" data-tip="拖动调整宽度" @pointerdown="startResize($event, -1)"></span>
        <span class="yy-image-handle right" data-tip="拖动调整宽度" @pointerdown="startResize($event, 1)"></span>
      </template>
      <span v-if="live !== null" class="yy-image-size">{{ live }} px</span>
    </span>
  </node-view-wrapper>
</template>
