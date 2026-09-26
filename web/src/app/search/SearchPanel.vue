<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { BookOpen, FileText, Search } from 'lucide-vue-next'
import { api, errorMessage, type Book, type DocSummary, type SearchHit, type TitleEntry } from '../../shared/api'
import { recentlyViewed } from '../prefs'
import { loadBooks } from '../store'
import { parts } from './highlight'
import { score, units, type Units } from './match'
import { searchOpen } from './panel'

// Opened with Cmd/Ctrl+K or the sidebar's search button. Before typing it lists recent documents;
// then knowledge bases and documents whose name matches, also by pinyin, at once, and full-text
// results a moment later. Full-text results open with the query highlighted in the document.
interface Item {
  key: string
  to: RouteLocationRaw
  icon: Component
  title: string
  where: string
  snippet?: string
}

const router = useRouter()
const query = ref('')
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const index = ref<(TitleEntry & { spelled: Units })[]>([])
const books = ref<(Book & { spelled: Units })[]>([])
const edited = ref<DocSummary[]>([])
const hits = ref<SearchHit[]>([])
const searched = ref('')
const failure = ref('')
const active = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined

const where = (bookName: string, path: string[] = []) => [bookName, ...path].join(' / ')

async function load() {
  failure.value = ''
  try {
    const [titles, recent, all] = await Promise.all([api<TitleEntry[]>('titles'), api<DocSummary[]>('recent'), loadBooks()])
    index.value = titles.map((t) => ({ ...t, spelled: units(t.pinyin) }))
    books.value = all.map((b) => ({ ...b, spelled: units(b.pinyin ?? '') }))
    edited.value = recent
  } catch (e) {
    failure.value = errorMessage(e)
  }
}

watch(
  searchOpen,
  (open) => {
    if (!open) return
    query.value = ''
    hits.value = []
    searched.value = ''
    active.value = 0
    void load()
  },
  { immediate: true },
)

watch(query, (q) => {
  active.value = 0
  clearTimeout(timer)
  const text = q.trim()
  if (!text) {
    hits.value = []
    searched.value = ''
    return
  }
  timer = setTimeout(async () => {
    try {
      const result = await api<SearchHit[]>(`search?q=${encodeURIComponent(text)}`)
      if (text === query.value.trim()) {
        hits.value = result
        searched.value = text
      }
    } catch (e) {
      failure.value = errorMessage(e)
    }
  }, 200)
})

// The best matches first; among equals, the shorter name.
function ranked<T>(list: T[], name: (x: T) => string, spelled: (x: T) => Units, q: string, limit: number): T[] {
  return list
    .map((x) => ({ x, s: score(name(x), spelled(x), q) }))
    .filter((m) => m.s > 0)
    .sort((a, b) => b.s - a.s || name(a.x).length - name(b.x).length)
    .slice(0, limit)
    .map((m) => m.x)
}

const sections = computed<{ name: string; items: Item[] }[]>(() => {
  const q = query.value.trim()
  const byId = new Map(index.value.map((t) => [t.id, t]))
  const doc = (id: number, title: string, bookName: string, snippet?: string, highlight?: string): Item => {
    const t = byId.get(id)
    return {
      key: `d${id}`,
      to: highlight ? { path: `/docs/${id}`, query: { hl: highlight } } : `/docs/${id}`,
      icon: FileText,
      title: t?.title ?? title,
      where: t ? where(t.bookName, t.path) : bookName,
      snippet,
    }
  }
  if (!q) {
    const viewed = recentlyViewed()
      .filter((v) => byId.has(v.id))
      .slice(0, 6)
    const seen = new Set(viewed.map((v) => v.id))
    const recent = edited.value.filter((d) => d.kind === 'doc' && !seen.has(d.id)).slice(0, 6)
    return [
      { name: '最近浏览', items: viewed.map((v) => doc(v.id, v.title, v.bookName)) },
      { name: '最近编辑', items: recent.map((d) => doc(d.id, d.title, d.bookName)) },
    ].filter((s) => s.items.length)
  }
  const matchedBooks = ranked(books.value, (b) => b.name, (b) => b.spelled, q, 5)
  const titled = ranked(index.value, (t) => t.title, (t) => t.spelled, q, 8)
  const shown = new Set(titled.map((t) => t.id))
  const text = searched.value === q ? hits.value.filter((h) => !shown.has(h.id)).slice(0, 8) : []
  return [
    {
      name: '知识库',
      items: matchedBooks.map((b) => ({ key: `b${b.id}`, to: `/books/${b.id}`, icon: BookOpen, title: b.name, where: `${b.docCount} 篇文档` })),
    },
    { name: '标题', items: titled.map((t) => doc(t.id, t.title, t.bookName)) },
    { name: '正文', items: text.map((h) => doc(h.id, h.title, h.bookName, h.snippet, q)) },
  ].filter((s) => s.items.length)
})

const items = computed(() => sections.value.flatMap((s) => s.items))
const offsets = computed(() => {
  let n = 0
  return sections.value.map((s) => {
    const at = n
    n += s.items.length
    return at
  })
})

watch(active, async (i) => {
  await nextTick()
  list.value?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' })
})

function go(it: Item) {
  searchOpen.value = false
  void router.push(it.to)
}

function showAll() {
  const q = query.value.trim()
  searchOpen.value = false
  void router.push({ path: '/search', query: q ? { q } : {} })
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return
  const n = items.value.length
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    active.value = (active.value + n - 1) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const hit = items.value[active.value]
    if (hit) go(hit)
    else if (query.value.trim()) showAll()
  }
}
</script>

<template>
  <DialogRoot v-model:open="searchOpen">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-search-panel" :aria-describedby="undefined" @open-auto-focus.prevent="input?.focus()">
        <DialogTitle class="yy-visually-hidden">搜索文档</DialogTitle>
        <div class="yy-search-field">
          <Search :size="18" />
          <input ref="input" v-model="query" placeholder="搜索知识库、标题和正文，名称也可以用拼音" aria-label="搜索文档" @keydown="onKey" />
          <kbd>Esc</kbd>
        </div>
        <div ref="list" class="yy-search-results" role="listbox" aria-label="搜索结果">
          <p v-if="failure" class="yy-search-note">加载失败：{{ failure }}</p>
          <template v-for="(s, si) in sections" :key="s.name">
            <div class="yy-search-section">{{ s.name }}</div>
            <button
              v-for="(it, k) in s.items"
              :key="it.key"
              type="button"
              role="option"
              class="yy-search-item"
              :class="{ active: offsets[si] + k === active }"
              :aria-selected="offsets[si] + k === active"
              :data-index="offsets[si] + k"
              @mouseenter="active = offsets[si] + k"
              @click="go(it)"
            >
              <component :is="it.icon" :size="16" />
              <span class="yy-search-text">
                <span class="yy-search-title"><template v-for="(p, i) in parts(it.title, query)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
                <span class="yy-search-where">{{ it.where }}</span>
                <span v-if="it.snippet" class="yy-search-snippet"><template v-for="(p, i) in parts(it.snippet, searched)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
              </span>
            </button>
          </template>
          <p v-if="!items.length && query.trim() && searched === query.trim()" class="yy-search-note">没有找到“{{ query.trim() }}”</p>
        </div>
        <div class="yy-search-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>Enter</kbd> 打开</span>
          <button v-if="query.trim()" type="button" class="yy-btn small" @click="showAll">查看全部结果</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
