<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { base, errorMessage, type ImageSizes } from '../../shared/api'
import { stopLoading } from '../../shared/images'
import { toast } from '../../ui/toast'
import { prefs } from '../prefs'
import { cleanupCode, enhance, enhanceCopy } from './enhance'
import { reveal, setupFolds } from './folds'
import Lightbox, { type LightboxImage } from './Lightbox.vue'
import { addMatches, clearMatches, showMatches } from './matches'
import { placeSegments, type SegmentSource } from './placeholders'
import { captureReadingPosition, restoreReadingPosition, type ReadingPosition } from './readingPosition'
import type { SegmentReader } from './segments'
import { parseRect } from '../../schema/imageGeometry'
import { setupLinkPreviews } from '../../shared/linkPreview'
import { prepareAttachmentCards, type PreviewAttachment } from './attachmentPreview'

const AttachmentPreviewDialog = defineAsyncComponent(() => import('./AttachmentPreviewDialog.vue'))
const attachment = ref<PreviewAttachment | null>(null)

// Shows HTML rendered by the Go renderer. Links inside the site open within the app. highlight is
// the text searched for when the page was opened from search results; foldKey names the document
// whose folded sections are remembered. A long document comes in segments (DESIGN 26.2): html
// is the first, and the rest load into placeholders. Whatever locates content goes through
// show, ensureBlock or loadAll rather than assuming all of it is in the page.
const props = defineProps<{ html: string; math?: boolean; mermaid?: boolean; images?: ImageSizes; highlight?: string; foldKey?: string; readingPosition?: ReadingPosition; segments?: SegmentSource }>()
const router = useRouter()
const root = ref<HTMLElement | null>(null)
const emit = defineEmits<{ ready: []; stale: [] }>()
// The elements and HTML of each segment as rendered, before enhancement, for recent changes.
let sourceElements: Element[][] = []
let sourceHTML: string[] = []
let reader: SegmentReader | undefined
// Copies of earlier content shown by recent changes (recentGhosts.ts) draw like the page. Passed
// to it rather than imported, so its lazily loaded code does not split the page's own modules.
function prepareCopy(node: HTMLElement) {
  prepareAttachmentCards(node)
  void enhanceCopy(node).catch(warn)
}
const complete = () => !reader || reader.complete()
defineExpose({
  source: () => ({ root: root.value, elements: sourceElements.flat(), prepare: prepareCopy, html: complete() ? sourceHTML.join('') : undefined }),
  show, loadAll, complete,
  ensureBlock: (block: number) => reader?.ensureBlock(block),
})
// The content is re-created from the HTML when it changes, and on a theme change to redraw
// diagrams in the theme's colours (renew).
const generation = ref(0)
let drawn: Promise<unknown> = Promise.resolve()
let initialPosition = props.readingPosition
let previewCleanup = () => {}
let runs = 0
const warn = (e: unknown) => console.warn('enhance', e)

async function run() {
  const token = ++runs
  const position = initialPosition
  initialPosition = undefined // Only on entry or a reload, not a later theme change or redraw.
  reader?.destroy()
  reader = undefined
  await nextTick()
  const el = root.value
  if (!el || token !== runs) return
  sourceElements = [[...el.querySelectorAll('*')]]
  sourceHTML = [props.html]
  prepareAttachmentCards(el)
  previewCleanup()
  previewCleanup = setupLinkPreviews(el)
  const options = { math: !!props.math, mermaid: !!props.mermaid, images: props.images }
  drawn = enhance(el, options).catch(warn)
  const source = props.segments
  const placeholders = source ? placeSegments(el, source) : []
  setupFolds(el, props.foldKey)
  if (source) {
    const { readSegments } = await import('./segments')
    if (token !== runs) return
    reader = readSegments(el, source, placeholders, {
      prepare(scope, index, html, firstCode, images) {
        sourceElements[index] = [...scope.querySelectorAll('*')]
        sourceHTML[index] = html
        prepareAttachmentCards(scope)
        return enhance(el, { ...options, images }, scope, firstCode).catch(warn)
      },
      inserted(nodes) {
        setupFolds(el, props.foldKey)
        if (props.highlight) addMatches(nodes, props.highlight)
      },
      stale() {
        initialPosition = captureReadingPosition()
        emit('stale')
      },
    })
  }
  if (location.hash) await scrollTo(decodeURIComponent(location.hash.slice(1)))
  if (token !== runs) return
  if (!position) reader?.start()
  await mark()
  await drawn
  if (token !== runs) return
  emit('ready')
  if (position) {
    await reader?.ensureBlock(position.block)
    if (token === runs && root.value?.isConnected) restoreReadingPosition(root.value, position)
    reader?.start()
  }
}

// Finds a heading or other element by ID, loading the segment it is in and unfolding what hides it.
async function show(id: string): Promise<HTMLElement | null> {
  await reader?.ensureId(id)
  const target = document.getElementById(id)
  if (!target || !root.value?.contains(target)) return null
  reveal(target)
  return target
}

async function scrollTo(id: string, smooth = false) {
  const target = await show(id)
  if (!target) return
  // A smooth scroll far through a long document would pass placeholders and load them on the way.
  const far = !!reader && Math.abs(target.getBoundingClientRect().top) > innerHeight * 2
  target.scrollIntoView({ behavior: smooth && !far ? 'smooth' : 'auto' })
}

async function loadAll(): Promise<boolean> {
  const current = reader
  if (!current || current.complete()) return true
  toast('正在载入全文…', 'loading', { key: 'segments' })
  try {
    await current.loadAll((loaded, total) => toast(`正在载入全文 ${loaded}/${total}`, 'loading', { key: 'segments' }))
    await drawn
    toast('已载入全文', 'success', { key: 'segments', ms: 1500 })
    return current === reader && current.complete()
  } catch (e) {
    toast(`载入全文失败：${errorMessage(e)}`, 'error', { key: 'segments' })
    return false
  }
}

// Matches are found once formulas and diagrams are drawn, so the page does not move afterwards.
// In a long document the server names the segments with matches; the first that has one in the
// page as drawn is loaded and shown.
async function mark() {
  clearMatches()
  const query = props.highlight
  if (!query) return
  await drawn
  const el = root.value
  if (!el) return
  const current = reader
  if (current) {
    const candidates = await current.matches(query)
    for (const i of candidates.slice(0, 5)) {
      await current.ensure(i)
      if (current !== reader || props.highlight !== query) return
      if (showMatches(el, query)) return
    }
    if (candidates.length) return
  }
  showMatches(el, query)
}

// Finding in the page and printing need the whole document: printing waits for it, finding
// starts while it loads.
function onKey(e: KeyboardEvent) {
  if (complete() || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
  const key = e.key.toLowerCase()
  if (key === 'p') {
    e.preventDefault()
    void loadAll().then(ok => { if (ok) window.print() })
  } else if (key === 'f') {
    void loadAll()
  }
}

// Printing from the browser's menu cannot wait: what is not loaded prints as a notice, and the
// rest starts loading for the next try.
function onBeforePrint() {
  if (!complete()) void loadAll()
}

// Starts again from a fresh copy of the HTML. Vue leaves the old one in place when only the
// segments changed, and loaded segments, placeholders and drawn diagrams are not in the HTML.
function renew() {
  if (root.value) cleanupCode(root.value)
  generation.value++
  void run()
}

onMounted(run)
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('beforeprint', onBeforePrint) })
watch([() => props.html, () => props.segments?.version], () => { attachment.value = null; renew() })
watch(() => props.highlight, mark)
onBeforeUnmount(() => {
  runs++
  reader?.destroy()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('beforeprint', onBeforePrint)
  previewCleanup()
  clearMatches()
  if (root.value) { cleanupCode(root.value); stopLoading(root.value) }
})
watch(() => router.currentRoute.value.hash, hash => { if (hash) void scrollTo(decodeURIComponent(hash.slice(1)), true) })
watch(
  () => prefs.theme,
  () => {
    if (!props.mermaid) return
    if (reader) initialPosition = captureReadingPosition()
    renew()
  },
)

const images = ref<LightboxImage[]>([])
const shown = ref<number | null>(null)

function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const file = target.closest<HTMLElement>('.yy-attachment-open')?.closest<HTMLElement>('[data-attachment]')
  if (file) {
    e.preventDefault()
    const download = file.querySelector<HTMLAnchorElement>('a[download]')!
    attachment.value = { src: file.dataset.src!, name: file.dataset.name!, download: download.href, size: file.querySelector('.yy-attachment-size')?.textContent ?? '' }
    return
  }
  // Copies of deleted content (recentGhosts.ts) only show what was there.
  const copy = !!target.closest('.yy-recent-ghost')
  const title = target.closest('.callout[data-callout-fold] > .callout-title, .code-block > .code-title')
  if (title && !copy && !target.closest('.yy-copy, .yy-code-wrap-btn, .yy-code-actions')) {
    title.parentElement?.classList.toggle('is-collapsed')
    return
  }
  // Linked images keep following their link.
  if (target instanceof HTMLImageElement && !copy && !target.closest('a') && root.value) {
    const all = [...root.value.querySelectorAll<HTMLImageElement>('img')].filter((img) => !img.closest('a, .yy-recent-ghost'))
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
  if (!a || a.hasAttribute('download') || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('#')) {
    e.preventDefault()
    scrollTo(decodeURIComponent(href.slice(1)), true)
  } else if (href.startsWith(base)) {
    e.preventDefault()
    void router.push(href.slice(base.length - 1))
  }
}

function onReplace(e: Event) {
  for (const part of sourceElements) {
    const i = part?.indexOf(e.target as Element) ?? -1
    if (i >= 0) { part[i] = (e as CustomEvent<Element>).detail; return }
  }
}
</script>

<template>
  <div :key="generation" ref="root" class="yy-content" @click="onClick" @yy-content-replaced="onReplace" v-html="html"></div>
  <Lightbox v-model:index="shown" :images="images" />
  <AttachmentPreviewDialog v-if="attachment" :attachment="attachment" @close="attachment = null" />
</template>
