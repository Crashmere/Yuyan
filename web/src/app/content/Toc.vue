<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Heading } from '../../shared/api'
import { prefs } from '../prefs'
import { reveal } from './folds'
import { topbarHeight, useOutlineTracking } from './outline'
import OutlinePanel from './OutlinePanel.vue'

// The outline beside a document being read. Jumps put headings just below the top bar
// (scroll-margin-top in content.css). A long document read in segments passes locate, which loads
// the segment a heading is in; a jump far through it does not scroll smoothly past placeholders.
const props = defineProps<{ items: Heading[]; locate?: (id: string) => Promise<Element | null> }>()
const emit = defineEmits<{ navigate: [] }>()
const router = useRouter()
const entries = computed(() => props.items.map((h) => ({ key: h.id, level: h.level, text: h.text, href: `#${h.id}` })))
const { active, refresh, jumped } = useOutlineTracking(
  // Headings of a segment still being prepared inside its placeholder are not in place yet.
  () => props.items.map((h) => document.getElementById(h.id)).map((el) => (el?.closest('.yy-segment') ? null : el)),
  () => topbarHeight() + 24,
)
watch(
  () => props.items,
  async () => {
    await nextTick()
    refresh()
  },
  { immediate: true },
)

async function go(i: number) {
  const h = props.items[i]
  const el = props.locate ? await props.locate(h.id) : document.getElementById(h.id)
  if (el) reveal(el)
  const far = !!props.locate && !!el && Math.abs(el.getBoundingClientRect().top) > innerHeight * 2
  el?.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'start' })
  jumped(i)
  void router.replace({ hash: `#${h.id}` })
  emit('navigate')
}
</script>

<template>
  <OutlinePanel :items="entries" :active="active" :pinned="prefs.readingOutline" @pin="(v) => (prefs.readingOutline = v)" @go="go" />
</template>
