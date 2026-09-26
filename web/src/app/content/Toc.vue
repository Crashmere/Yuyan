<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Heading } from '../../shared/api'

// The outline beside a document; the entry for the heading at the top of the page is highlighted.
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
  document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  active.value = h.id
  void router.replace({ hash: `#${h.id}` })
  emit('navigate')
}
</script>

<template>
  <nav class="yy-toc" aria-label="大纲">
    <div class="yy-toc-title">大纲</div>
    <ul>
      <li v-for="h in items" :key="h.id" :style="{ '--level': h.level - minLevel }">
        <a :href="`#${h.id}`" :class="{ active: active === h.id }" :title="h.text" @click.prevent="go(h)">{{ h.text }}</a>
      </li>
    </ul>
  </nav>
</template>
