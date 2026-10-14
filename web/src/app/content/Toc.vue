<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Heading } from '../../shared/api'
import { scrollToElement } from '../../shared/scroll'
import { prefs } from '../prefs'
import { reveal } from './folds'
import { topbarHeight, useOutlineTracking } from './outline'
import OutlinePanel from './OutlinePanel.vue'

// The outline beside a document being read. Jumps put headings just below the top bar
// (scroll-margin-top in content.css). A long document read in segments passes locate, which loads
// the segment a heading is in before jumping directly to it.
const props = defineProps<{ items: Heading[]; locate?: (id: string) => Promise<Element | null> }>()
const emit = defineEmits<{ navigate: [] }>()
const router = useRouter()
let jumpSequence = 0
onBeforeUnmount(() => { jumpSequence++ })
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
  const sequence = ++jumpSequence
  const h = props.items[i]
  const el = props.locate ? await props.locate(h.id) : document.getElementById(h.id)
  if (sequence !== jumpSequence) return
  if (el) reveal(el)
  jumped(i)
  // DocContent handles changed hashes. Repeated clicks still locate and renew the heading cue.
  if (router.currentRoute.value.hash !== `#${h.id}`) void router.replace({ hash: `#${h.id}` })
  else if (el) scrollToElement(el, 'start', true)
  emit('navigate')
}
</script>

<template>
  <OutlinePanel :items="entries" :active="active" :pinned="prefs.readingOutline" @pin="(v) => (prefs.readingOutline = v)" @go="go" />
</template>
