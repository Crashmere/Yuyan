<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, CopyCheck, Crop, Group, Scissors, Square } from 'lucide-vue-next'
import { useEditorContext } from './context'
import { selectionContent } from './selectionContent'
import { imageSizeLabel, imageSizes, resizeSelectedImages, updateSelectedImages } from './imageFormat'
import { boardAt, groupImages } from './imageOperations'

const { editor, tick, ui } = useEditorContext()
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
    <button type="button" class="yy-bubble-btn" data-tip="裁切图片" aria-label="裁切图片" @mousedown.prevent @click="ui.openImageTools('crop')"><Crop :size="16" /></button>
    <button v-if="images.length === 1" type="button" class="yy-bubble-btn" data-tip="切分图片" aria-label="切分图片" @mousedown.prevent @click="ui.openImageTools('split')"><Scissors :size="16" /></button>
    <button type="button" class="yy-bubble-btn" data-tip="批量应用图片参数" aria-label="批量应用图片参数" @mousedown.prevent @click="ui.openImageTools('apply')"><CopyCheck :size="16" /></button>
    <button v-if="images.every((t) => !boardAt(editor!, t.pos))" type="button" class="yy-bubble-btn" data-tip="组合为图片画板" aria-label="组合为图片画板" @mousedown.prevent @click="groupImages(editor)"><Group :size="16" /></button>
  </template>
</template>
