<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { drawingPreview, drawingStyle } from '../../schema/drawing'
import { assetURL } from '../../shared/api'
import { openDrawing } from '../../drawing/open'
const props = defineProps(nodeViewProps)
function edit() { const pos = props.getPos(); if (pos !== undefined) void openDrawing(props.editor, pos) }
function width(event: Event) { const value = Number((event.target as HTMLInputElement).value); if (Number.isFinite(value)) props.updateAttributes({ width: Math.max(100, Math.min(2400, Math.round(value))) }) }
</script>
<template>
  <NodeViewWrapper contenteditable="false" class="yy-drawing-editor" :class="{ 'ProseMirror-selectednode': selected }">
    <figure class="yy-drawing" :style="drawingStyle(node.attrs)">
      <img :src="assetURL(drawingPreview(node.attrs.src))" :width="node.attrs.previewWidth" :height="node.attrs.previewHeight" :alt="node.attrs.caption || '画板'" loading="lazy" @dblclick.stop="edit" />
      <figcaption v-if="node.attrs.caption">{{ node.attrs.caption }}</figcaption>
    </figure>
    <div class="yy-drawing-controls" @mousedown.stop>
      <button class="yy-btn small" @click.stop="edit">编辑画板</button>
      <label>宽度 <input type="number" class="yy-input" min="100" max="2400" :value="node.attrs.width" aria-label="画板显示宽度" @change="width" /></label>
      <select class="yy-input" :value="node.attrs.blockAlign" aria-label="画板对齐" @change="updateAttributes({ blockAlign: ($event.target as HTMLSelectElement).value })"><option value="left">居左</option><option value="center">居中</option><option value="right">居右</option></select>
      <input class="yy-input yy-drawing-caption-input" :value="node.attrs.caption" placeholder="添加画板说明" aria-label="画板说明" @change="updateAttributes({ caption: ($event.target as HTMLInputElement).value })" />
    </div>
  </NodeViewWrapper>
</template>
