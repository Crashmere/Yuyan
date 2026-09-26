<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import { api, errorMessage, type SearchHit } from '../../shared/api'
import { setTitle } from '../router'
import { parts } from '../search/highlight'
import { loading, setPage } from '../store'

setPage(null)
setTitle('搜索')

const route = useRoute()
const router = useRouter()
const q = ref(String(route.query.q ?? ''))
const searched = ref('')
const hits = ref<SearchHit[]>([])
const failure = ref('')
const input = ref<HTMLInputElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

async function run(query: string) {
  query = query.trim()
  void router.replace({ query: query ? { q: query } : {} })
  if (!query) {
    hits.value = []
    searched.value = ''
    return
  }
  try {
    failure.value = ''
    const result = await loading(api<SearchHit[]>(`search?q=${encodeURIComponent(query)}`))
    if (query === q.value.trim()) {
      hits.value = result
      searched.value = query
    }
  } catch (e) {
    failure.value = errorMessage(e)
  }
}

watch(q, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => void run(v), 250)
})

onMounted(() => {
  input.value?.focus()
  if (q.value) void run(q.value)
})
</script>

<template>
  <main class="yy-page yy-narrow">
    <form class="yy-search-box" role="search" @submit.prevent="run(q)">
      <Search :size="18" />
      <input ref="input" v-model="q" type="search" placeholder="搜索全部文档的标题和正文" aria-label="搜索" />
    </form>
    <p v-if="failure" class="yy-page-error">搜索失败：{{ failure }}</p>
    <template v-else-if="searched">
      <p class="yy-page-sub">“{{ searched }}”共 {{ hits.length }} 条结果{{ hits.length === 50 ? '（只显示前 50 条）' : '' }}</p>
      <ul class="yy-results">
        <li v-for="h in hits" :key="h.id">
          <RouterLink :to="{ path: `/docs/${h.id}`, query: { hl: searched } }" class="yy-result-title">
            <template v-for="(p, i) in parts(h.title, searched)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
          </RouterLink>
          <span class="yy-result-book">{{ h.bookName }}</span>
          <p class="yy-result-snippet">
            <template v-for="(p, i) in parts(h.snippet, searched)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
          </p>
        </li>
      </ul>
    </template>
  </main>
</template>
