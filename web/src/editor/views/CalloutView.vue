<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { calloutTypes } from '../../schema/callout'

const props = defineProps(nodeViewProps)

const type = computed({
  get: () => String(props.node.attrs.type || 'note'),
  set: (v: string) => props.updateAttributes({ type: v }),
})
const fold = computed({
  get: () => String(props.node.attrs.fold || ''),
  set: (v: string) => props.updateAttributes({ fold: v }),
})
const types = computed(() => (calloutTypes.includes(type.value) ? calloutTypes : [...calloutTypes, type.value]))
</script>

<template>
  <!-- The editor never hides callout content; the fold setting only affects reading pages. -->
  <node-view-wrapper class="callout" :data-callout="type" :data-callout-fold="fold || undefined">
    <div class="yy-callout-bar" contenteditable="false">
      <select v-model="type" aria-label="Callout 类型">
        <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
      </select>
      <select v-model="fold" aria-label="折叠方式">
        <option value="">不折叠</option>
        <option value="+">默认展开</option>
        <option value="-">默认折叠</option>
      </select>
    </div>
    <node-view-content />
  </node-view-wrapper>
</template>
