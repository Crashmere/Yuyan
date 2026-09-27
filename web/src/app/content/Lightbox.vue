<script lang="ts">
export interface LightboxImage {
  src: string
  alt: string
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-vue-next'

// A page's images at full size, one at a time, with the arrow keys moving between them.
const props = defineProps<{ images: LightboxImage[] }>()
const index = defineModel<number | null>('index', { required: true })

const open = computed({
  get: () => index.value !== null,
  set: (v) => {
    if (!v) index.value = null
  },
})
const current = computed(() => (index.value === null ? null : props.images[index.value]))

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
        <img v-if="current" :key="current.src" :src="current.src" :alt="current.alt" class="yy-lightbox-img" @click="open = false" />
        <template v-if="images.length > 1">
          <button type="button" class="yy-lightbox-nav prev" aria-label="上一张" @click="go(-1)"><ChevronLeft :size="28" /></button>
          <button type="button" class="yy-lightbox-nav next" aria-label="下一张" @click="go(1)"><ChevronRight :size="28" /></button>
        </template>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
