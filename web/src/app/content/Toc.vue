<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff } from 'lucide-vue-next'
import type { Heading } from '../../shared/api'
import IconButton from '../../ui/IconButton.vue'
import { prefs } from '../prefs'
import { reveal } from './folds'

// The outline beside a document; the entry for the heading at the top of the page is highlighted.
// As in Yuque, the eye beside its title only pins it: unpinned, it shows as a line per heading and
// opens over them while the pointer is near (app.css). The choice is kept in this browser.
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
