<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { base, type ImageSizes } from '../../shared/api'
import { stopLoading } from '../../shared/images'
import { prefs } from '../prefs'
import { cleanupCode, enhance } from './enhance'
import { reveal, setupFolds } from './folds'
import Lightbox, { type LightboxImage } from './Lightbox.vue'
import { clearMatches, showMatches } from './matches'
import { restoreReadingPosition, type ReadingPosition } from './readingPosition'
import { parseRect } from '../../schema/imageGeometry'
import { setupLinkPreviews } from '../../shared/linkPreview'

// Shows HTML rendered by the Go renderer. Links inside the site open within the app. highlight is
// the text searched for when the page was opened from search results; foldKey names the document
// whose folded sections are remembered.
const props = defineProps<{ html: string; math?: boolean; mermaid?: boolean; images?: ImageSizes; highlight?: string; foldKey?: string; readingPosition?: ReadingPosition }>()
const router = useRouter()
const root = ref<HTMLElement | null>(null)
// Diagrams are drawn in the theme's colours; a theme change re-creates the content to redraw them.
const generation = ref(0)
let drawn: Promise<unknown> = Promise.resolve()
let initialPosition = props.readingPosition
let previewCleanup = () => {}

async function run() {
  const position = initialPosition
  initialPosition = undefined // Only on entry, not a later theme change or content redraw.
  await nextTick()
  if (!root.value) return
  previewCleanup()
  previewCleanup = setupLinkPreviews(root.value)
  drawn = enhance(root.value, { math: !!props.math, mermaid: !!props.mermaid, images: props.images }).catch((e: unknown) => console.warn('enhance', e))
  setupFolds(root.value, props.foldKey)
  if (location.hash) scrollTo(decodeURIComponent(location.hash.slice(1)))
  await mark()
  if (position) {
    await drawn
    if (root.value?.isConnected) restoreReadingPosition(root.value, position)
  }
}

function scrollTo(id: string, smooth = false) {
  const target = document.getElementById(id)
  if (!target || !root.value?.contains(target)) return
  reveal(target)
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
}

// Matches are found once formulas and diagrams are drawn, so the page does not move afterwards.
async function mark() {
  clearMatches()
  if (!props.highlight) return
  await drawn
  if (root.value) showMatches(root.value, props.highlight)
}

onMounted(run)
watch(() => props.html, run)
watch(() => props.highlight, mark)
onBeforeUnmount(() => {
  previewCleanup()
  clearMatches()
  if (root.value) { cleanupCode(root.value); stopLoading(root.value) }
})
watch(() => router.currentRoute.value.hash, hash => { if (hash) scrollTo(decodeURIComponent(hash.slice(1)), true) })
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
  const title = target.closest('.callout[data-callout-fold] > .callout-title, .code-block > .code-title')
  if (title && !target.closest('.yy-copy, .yy-code-wrap-btn, .yy-code-actions')) {
    title.parentElement?.classList.toggle('is-collapsed')
    return
  }
  // Linked images keep following their link.
  if (target instanceof HTMLImageElement && !target.closest('a') && root.value) {
    const all = [...root.value.querySelectorAll<HTMLImageElement>('img')].filter((img) => !img.closest('a'))
    images.value = all.map((img) => ({
      src: img.currentSrc || img.src, alt: img.alt,
      crop: parseRect(img.getAttribute('data-crop'), true),
      sourceWidth: Number(img.getAttribute('data-source-width')) || img.naturalWidth,
      sourceHeight: Number(img.getAttribute('data-source-height')) || img.naturalHeight,
    }))
    shown.value = all.indexOf(target)
    return
  }
  const a = target.closest<HTMLAnchorElement>('a[href]')
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('#')) {
    e.preventDefault()
    scrollTo(decodeURIComponent(href.slice(1)), true)
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
