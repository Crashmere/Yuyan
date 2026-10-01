<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ChevronRight, Link } from 'lucide-vue-next'
import { api, errorMessage } from '../../shared/api'

const props = defineProps<{ docId: number }>()
interface Backlink { id: number; title: string; bookName: string; heading: string; snippet: string }
const open = ref(false), busy = ref(false), failure = ref(''), items = ref<Backlink[] | null>(null)
async function toggle() {
  open.value = !open.value
  if (!open.value || busy.value) return
  busy.value = true; failure.value = ''
  try { items.value = await api(`docs/${props.docId}/backlinks`) }
  catch (e) { failure.value = errorMessage(e) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="yy-backlinks">
    <button type="button" class="yy-backlinks-toggle" :aria-expanded="open" @click="toggle"><ChevronRight :size="14" :class="{ expanded: open }" /><Link :size="14" />链接到此文档<span v-if="items">{{ items.length }}</span></button>
    <div v-if="open" class="yy-backlinks-body">
      <p v-if="busy || failure || !items?.length">{{ busy ? '正在加载…' : failure || '还没有其他文档链接到这里' }}</p>
      <RouterLink v-for="item in busy ? [] : items" :key="item.id" :to="`/docs/${item.id}${item.heading ? '#' + encodeURIComponent(item.heading) : ''}`">
        <strong>{{ item.title }}</strong><small>{{ item.bookName }}</small><p>{{ item.snippet || '图片链接' }}</p>
      </RouterLink>
    </div>
  </section>
</template>
