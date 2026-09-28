<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, Square } from 'lucide-vue-next'
import { useEditorContext } from './context'
import { selectionContent } from './selectionContent'
import { imageSizeLabel, imageSizes, resizeSelectedImages, updateSelectedImages } from './imageFormat'

const { editor, tick } = useEditorContext()
const sizesOpen = ref(false)
const images = computed(() => { void tick.value; return editor.value ? selectionContent(editor.value.state).images : [] })
const shadow = computed(() => images.value.every(({ node }) => node.attrs.shadow === true))
const mixedShadow = computed(() => !shadow.value && images.value.some(({ node }) => node.attrs.shadow === true))
watch(() => { void tick.value; return editor.value?.state.selection }, () => { sizesOpen.value = false })

function resize(fraction: number) {
  sizesOpen.value = false
  if (editor.value) resizeSelectedImages(editor.value, fraction)
}
</script>

<template>
  <template v-if="editor && images.length">
    <div class="yy-bubble-styles">
      <button type="button" class="yy-bubble-select" aria-label="图片尺寸" :aria-expanded="sizesOpen" data-tip="调整选中图片的尺寸" @mousedown.prevent @click="sizesOpen = !sizesOpen">
        {{ imageSizeLabel(images) }}<ChevronDown :size="13" />
      </button>
      <div v-if="sizesOpen" class="yy-bubble-list">
        <button v-for="s in imageSizes" :key="s.label" type="button" @mousedown.prevent @click="resize(s.fraction)">{{ s.label }}</button>
      </div>
    </div>
    <slot />
    <button type="button" class="yy-bubble-btn" :class="{ active: shadow, 'is-mixed': mixedShadow }" :aria-pressed="mixedShadow ? 'mixed' : shadow" :data-tip="shadow ? '关闭选中图片的阴影边框' : '显示选中图片的阴影边框'" aria-label="阴影边框" @mousedown.prevent @click="updateSelectedImages(editor, { shadow: shadow ? null : true })"><Square :size="16" /></button>
  </template>
</template>
