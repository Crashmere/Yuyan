<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Eye } from 'lucide-vue-next'
import type { Heading } from '../../shared/api'
import IconButton from '../../ui/IconButton.vue'
import { prefs } from '../prefs'
import { reveal } from './folds'

// The outline beside a document; the entry for the heading at the top of the page is highlighted.
// As in Yuque, the eye beside its title hides it into the top bar's outline button, which brings it
// back; the choice is kept in this browser.
const props = defineProps<{ items: Heading[] }>()
const emit = defineEmits<{ navigate: [] }>()
const router = useRouter()
const active = ref<string | null>(null)
const minLevel = computed(() => Math.min(...props.items.map((h) => h.level)))
let observer: IntersectionObserver | null = null

watch(
  () => props.items,
  async (items) => {
    observer?.disconnect()
    await nextTick()
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) active.value = e.target.id
      },
      { rootMargin: '-64px 0px -70% 0px' },
    )
    for (const h of items) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => observer?.disconnect())

function go(h: Heading) {
  const el = document.getElementById(h.id)
  if (el) reveal(el)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  active.value = h.id
  void router.replace({ hash: `#${h.id}` })
  emit('navigate')
}
</script>

<template>
  <nav class="yy-toc" aria-label="大纲">
    <div class="yy-toc-head">
      <span class="yy-toc-title">大纲</span>
      <IconButton small class="yy-toc-eye" label="隐藏大纲" @click="prefs.readingOutline = false"><Eye :size="14" /></IconButton>
    </div>
    <ul>
      <li v-for="h in items" :key="h.id" :style="{ '--level': h.level - minLevel }">
        <a :href="`#${h.id}`" :class="{ active: active === h.id }" :title="h.text" @click.prevent="go(h)">{{ h.text }}</a>
      </li>
    </ul>
  </nav>
</template>
