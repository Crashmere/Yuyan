<script lang="ts">
import type { ImageRect } from '../../schema/imageGeometry'
export interface LightboxImage {
  src: string
  alt: string
  crop: ImageRect | null
  sourceWidth: number
  sourceHeight: number
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-vue-next'
import { cropImageStyle } from '../../schema/imageGeometry'

// Preview each image's visible crop at source resolution, fitted to the viewport.
const props = defineProps<{ images: LightboxImage[] }>()
const index = defineModel<number | null>('index', { required: true })

const open = computed({
  get: () => index.value !== null,
  set: (v) => {
    if (!v) index.value = null
  },
})
const current = computed(() => (index.value === null ? null : props.images[index.value]))
const natural = ref({ width: 0, height: 0 })
watch(current, () => { natural.value = { width: 0, height: 0 } })
const cropStyle = computed(() => {
  const image = current.value
  if (!image?.crop) return undefined
  const width = (image.sourceWidth || natural.value.width || 320) * image.crop.width
  const height = (image.sourceHeight || natural.value.height || 240) * image.crop.height
  return { '--yy-preview-width': `${width}px`, '--yy-preview-ratio': width / height }
})
function loaded(event: Event) {
  const image = event.target as HTMLImageElement
  if (image.getAttribute('src') === current.value?.src) natural.value = { width: image.naturalWidth, height: image.naturalHeight }
}

function go(step: number) {
  if (index.value === null || props.images.length < 2) return
  index.value = (index.value + step + props.images.length) % props.images.length
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'ArrowRight') go(1)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="yy-lightbox-overlay" />
      <DialogContent class="yy-lightbox" :aria-describedby="undefined" @keydown="onKey" @click.self="open = false">
        <div class="yy-lightbox-bar">
          <DialogTitle class="yy-lightbox-count">{{ (index ?? 0) + 1 }} / {{ images.length }}</DialogTitle>
          <span class="yy-lightbox-alt">{{ current?.alt }}</span>
          <a v-if="current" class="yy-lightbox-btn" :href="current.src" target="_blank" rel="noopener" data-tip="查看原图" aria-label="查看原图"><ExternalLink :size="18" /></a>
          <button type="button" class="yy-lightbox-btn" data-tip="关闭" aria-label="关闭" @click="open = false"><X :size="20" /></button>
        </div>
        <div v-if="current?.crop" :key="index!" class="yy-lightbox-img yy-lightbox-crop" :style="cropStyle" @click="open = false">
          <img :src="current.src" :alt="current.alt" :style="cropImageStyle(current.crop)" @load="loaded" />
        </div>
        <img v-else-if="current" :key="index!" :src="current.src" :alt="current.alt" class="yy-lightbox-img" @click="open = false" />
        <template v-if="images.length > 1">
          <button type="button" class="yy-lightbox-nav prev" aria-label="上一张" @click="go(-1)"><ChevronLeft :size="28" /></button>
          <button type="button" class="yy-lightbox-nav next" aria-label="下一张" @click="go(1)"><ChevronRight :size="28" /></button>
        </template>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
