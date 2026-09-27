<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Heading } from '../../shared/api'
import { prefs } from '../prefs'
import { reveal } from './folds'
import { topbarHeight, useOutlineTracking } from './outline'
import OutlinePanel from './OutlinePanel.vue'

// The outline beside a document being read. Jumps put headings just below the top bar
// (scroll-margin-top in content.css).
const props = defineProps<{ items: Heading[] }>()
const emit = defineEmits<{ navigate: [] }>()
const router = useRouter()
const entries = computed(() => props.items.map((h) => ({ key: h.id, level: h.level, text: h.text, href: `#${h.id}` })))
const { active, refresh, jumped } = useOutlineTracking(
  () => props.items.map((h) => document.getElementById(h.id)),
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

function go(i: number) {
  const h = props.items[i]
  const el = document.getElementById(h.id)
  if (el) reveal(el)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  jumped(i)
  void router.replace({ hash: `#${h.id}` })
  emit('navigate')
}
</script>

<template>
  <OutlinePanel :items="entries" :active="active" :pinned="prefs.readingOutline" @pin="(v) => (prefs.readingOutline = v)" @go="go" />
</template>
