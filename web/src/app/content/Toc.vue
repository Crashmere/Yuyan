<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff } from 'lucide-vue-next'
import type { Heading } from '../../shared/api'
import IconButton from '../../ui/IconButton.vue'
import { prefs } from '../prefs'
import { reveal } from './folds'

// The outline beside a document. As in Yuque, the eye beside its title only pins it: unpinned, it
// shows as a line per heading and opens over them while the pointer is near (app.css). The choice
// is kept in this browser.
const props = defineProps<{ items: Heading[] }>()
const emit = defineEmits<{ navigate: [] }>()
const router = useRouter()
const active = ref<string | null>(null)
const minLevel = computed(() => Math.min(...props.items.map((h) => h.level)))

// The section being read is the last heading above a line just below where jumps put headings
// (scroll-margin-top in content.css). Over the last screen of the page the line moves down to the
// bottom of the window, so the final sections, whose headings cannot reach it, get their turn.
// Headings in folded sections have no box and are skipped.
function update() {
  frame = 0
  if (jumping) return
  const root = document.documentElement
  const base = (parseFloat(getComputedStyle(root).getPropertyValue('--yy-topbar')) || 52) + 24
  const room = innerHeight - base
  const scrollable = root.scrollHeight - innerHeight
  const span = Math.min(scrollable, room)
  const left = scrollable - scrollY
  const line = span > 0 && left < span ? base + room * (1 - left / span) : base
  let current = props.items[0]?.id ?? null
  for (const h of props.items) {
    const el = document.getElementById(h.id)
    if (!el?.getClientRects().length) continue
    if (el.getBoundingClientRect().top > line) break
    current = h.id
  }
  active.value = current
}
let frame = 0
const schedule = () => {
  if (!frame) frame = requestAnimationFrame(update)
}

// After a jump from the outline the entry clicked stays highlighted: the smooth scroll passes
// other headings, and a heading near the end may never reach the line. Once the page has been
// still for a moment, the next scroll follows the page again.
let jumping = false
let still = false
let stillTimer: ReturnType<typeof setTimeout> | undefined
function waitStill() {
  clearTimeout(stillTimer)
  stillTimer = setTimeout(() => (still = true), 150)
}
function onScroll() {
  if (jumping) {
    if (!still) return waitStill()
    jumping = false
  }
  schedule()
}

onMounted(() => {
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', schedule)
})
onBeforeUnmount(() => {
  removeEventListener('scroll', onScroll)
  removeEventListener('resize', schedule)
  cancelAnimationFrame(frame)
  clearTimeout(stillTimer)
})
watch(
  () => props.items,
  async () => {
    await nextTick()
    schedule()
  },
  { immediate: true },
)

function go(h: Heading) {
  const el = document.getElementById(h.id)
  if (el) reveal(el)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  active.value = h.id
  jumping = true
  still = false
  waitStill()
  void router.replace({ hash: `#${h.id}` })
  emit('navigate')
}
</script>

<template>
  <nav class="yy-toc" :class="{ 'is-peek': !prefs.readingOutline }" aria-label="大纲">
    <div v-if="!prefs.readingOutline" class="yy-toc-lines" tabindex="0" aria-label="大纲">
      <span v-for="h in items" :key="h.id" :class="{ active: active === h.id }" :style="{ '--level': h.level - minLevel }"></span>
    </div>
    <div class="yy-toc-panel">
      <div class="yy-toc-head">
        <span class="yy-toc-title">大纲</span>
        <IconButton small class="yy-toc-eye" :label="prefs.readingOutline ? '隐藏大纲' : '固定显示大纲'" @click="prefs.readingOutline = !prefs.readingOutline">
          <Eye v-if="prefs.readingOutline" :size="14" /><EyeOff v-else :size="14" />
        </IconButton>
      </div>
      <ul>
        <li v-for="h in items" :key="h.id" :style="{ '--level': h.level - minLevel }">
          <a :href="`#${h.id}`" :class="{ active: active === h.id }" :title="h.text" @click.prevent="go(h)">{{ h.text }}</a>
        </li>
      </ul>
    </div>
  </nav>
</template>
