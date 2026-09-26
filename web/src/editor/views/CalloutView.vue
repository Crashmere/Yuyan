<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { defaultTitle } from '../callouts'
import CalloutMenu from './CalloutMenu.vue'

const props = defineProps(nodeViewProps)

const type = computed(() => String(props.node.attrs.type || 'note').toLowerCase())
const fold = computed(() => String(props.node.attrs.fold || ''))
</script>

<template>
  <!-- The editor never hides callout content; the fold setting only affects reading pages. An
       empty title shows the reading page's default title (editor.css). -->
  <node-view-wrapper
    class="callout"
    :data-callout="type"
    :data-callout-fold="fold || undefined"
    :style="{ '--yy-callout-default': JSON.stringify(defaultTitle(type)) }"
  >
    <div class="yy-callout-bar" contenteditable="false">
      <CalloutMenu :type="type" :fold="fold" @type="(t) => props.updateAttributes({ type: t })" @fold="(f) => props.updateAttributes({ fold: f })" />
    </div>
    <node-view-content />
  </node-view-wrapper>
</template>
