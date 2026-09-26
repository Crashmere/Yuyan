<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { base } from '../../shared/api'
import { prefs } from '../prefs'
import { enhance } from './enhance'
import Lightbox, { type LightboxImage } from './Lightbox.vue'

// Shows HTML rendered by the Go renderer. Links inside the site open within the app.
const props = defineProps<{ html: string; math?: boolean; mermaid?: boolean }>()
const router = useRouter()
const root = ref<HTMLElement | null>(null)
// Diagrams are drawn in the theme's colours; a theme change re-creates the content to redraw them.
const generation = ref(0)

async function run() {
  await nextTick()
  if (root.value) enhance(root.value, { math: !!props.math, mermaid: !!props.mermaid })
}

onMounted(run)
watch(() => props.html, run)
watch(
  () => prefs.theme,
  () => {
    if (!props.mermaid) return
    generation.value++
    void run()
  },
)

const images = ref<LightboxImage[]>([])
const shown = ref<number | null>(null)

function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const title = target.closest('.callout[data-callout-fold] > .callout-title')
  if (title) {
    title.parentElement?.classList.toggle('is-collapsed')
    return
  }
  // Linked images keep following their link.
  if (target instanceof HTMLImageElement && !target.closest('a') && root.value) {
    const all = [...root.value.querySelectorAll<HTMLImageElement>('img')].filter((img) => !img.closest('a'))
    images.value = all.map((img) => ({ src: img.currentSrc || img.src, alt: img.alt }))
    shown.value = all.indexOf(target)
    return
  }
  const a = target.closest<HTMLAnchorElement>('a[href]')
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('#')) {
    e.preventDefault()
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' })
  } else if (href.startsWith(base)) {
    e.preventDefault()
    void router.push(href.slice(base.length - 1))
  }
}
</script>

<template>
  <div :key="generation" ref="root" class="yy-content" @click="onClick" v-html="html"></div>
  <Lightbox v-model:index="shown" :images="images" />
</template>
