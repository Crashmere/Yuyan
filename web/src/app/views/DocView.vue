<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowLeft, ArrowRight, Ellipsis, FileText, Folder, PencilLine, TableOfContents } from 'lucide-vue-next'
import { api, ApiError, errorMessage, type DocView } from '../../shared/api'
import ActionMenu from '../../ui/ActionMenu.vue'
import IconButton from '../../ui/IconButton.vue'
import { newDoc, nodeMenu } from '../actions'
import DocContent from '../content/DocContent.vue'
import Toc from '../content/Toc.vue'
import { recordView } from '../prefs'
import { setTitle } from '../router'
import { loading, loadTree, locate, setPage, state } from '../store'
import { formatTime } from '../time'
import NotFoundState from './NotFoundState.vue'

const route = useRoute()
const id = Number(route.params.id)
const view = ref<DocView | null>(null)
const missing = ref(false)
const failure = ref('')
const tocOpen = ref(false)

// The editor is a large download; start fetching it when the pointer reaches the edit button.
const prefetchEditor = () => void import('./EditView.vue')

// Search results open documents with ?hl=<query>, which is highlighted in the content.
const highlight = computed(() => (typeof route.query.hl === 'string' ? route.query.hl : ''))
const node = computed(() => locate(state.bookId, id)?.node)
const menu = computed(() => (view.value && node.value ? nodeMenu(view.value.doc.bookId, node.value, { history: true }) : []))
const title = computed(() => node.value?.title ?? view.value?.doc.title ?? '')
// A new document holds one empty paragraph; treat anything without text or visible blocks as empty.
const empty = computed(() => !!view.value && view.value.chars === 0 && !/<(img|table|pre|hr|div)\b/.test(view.value.html))
// Titles shown on this page follow the tree, which stays current after renames elsewhere.
const titleOf = (n: { id: number; title: string }) => locate(state.bookId, n.id)?.node.title ?? n.title

onMounted(async () => {
  try {
    const v = await loading(api<DocView>(`docs/${id}/view`))
    view.value = v
    setPage(v.doc.bookId, v.doc.id)
    setTitle(v.doc.title)
    void loadTree(v.doc.bookId)
    if (v.doc.kind === 'doc') recordView({ id: v.doc.id, title: v.doc.title, bookId: v.doc.bookId, bookName: v.doc.bookName })
    await nextTick()
    if (route.hash) document.getElementById(decodeURIComponent(route.hash.slice(1)))?.scrollIntoView()
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      missing.value = true
      setPage(null)
      setTitle('找不到内容')
    } else {
      failure.value = errorMessage(e)
    }
  }
})
</script>

<template>
  <Teleport defer to="#yy-topbar-actions">
    <template v-if="view">
      <IconButton v-if="view.toc.length" class="yy-toc-btn" label="大纲" :active="tocOpen" @click="tocOpen = !tocOpen">
        <TableOfContents :size="18" />
      </IconButton>
      <RouterLink v-if="view.doc.kind === 'doc'" :to="`/docs/${id}/edit`" class="yy-btn primary" @mouseenter="prefetchEditor" @focus="prefetchEditor">
        <PencilLine :size="15" />编辑
      </RouterLink>
      <ActionMenu :items="menu"><IconButton label="更多操作"><Ellipsis :size="18" /></IconButton></ActionMenu>
    </template>
  </Teleport>

  <main v-if="missing" class="yy-page"><NotFoundState /></main>
  <main v-else-if="failure" class="yy-page"><p class="yy-page-error">加载失败：{{ failure }}</p></main>
  <main v-else-if="view" class="yy-doc-page" :class="{ 'has-toc': view.toc.length > 0, 'toc-open': tocOpen }">
    <article class="yy-article">
      <h1 class="yy-doc-title">{{ title }}</h1>
      <div class="yy-doc-meta">
        <span>更新于 {{ formatTime(view.doc.updatedAt) }}</span>
        <span v-if="view.doc.kind === 'doc'">{{ view.chars.toLocaleString() }} 字</span>
      </div>
      <template v-if="view.doc.kind === 'group'">
        <ul v-if="view.children.length" class="yy-child-list">
          <li v-for="c in view.children" :key="c.id">
            <RouterLink :to="`/docs/${c.id}`"><component :is="c.kind === 'group' ? Folder : FileText" :size="16" />{{ titleOf(c) }}</RouterLink>
          </li>
        </ul>
        <div v-else class="yy-empty-inline">
          这个分组下还没有文档。
          <button type="button" class="yy-link-btn" @click="newDoc(view.doc.bookId, view.doc.id)">新建一篇</button>
        </div>
      </template>
      <div v-else-if="empty" class="yy-empty-inline">
        这篇文档还是空的。<RouterLink :to="`/docs/${id}/edit`" class="yy-link-btn">开始写作</RouterLink>
      </div>
      <DocContent v-else :html="view.html" :math="view.hasMath" :mermaid="view.hasMermaid" :images="view.images" :highlight="highlight" />
      <nav v-if="view.prev || view.next" class="yy-pager">
        <RouterLink v-if="view.prev" :to="`/docs/${view.prev.id}`" class="prev">
          <span class="yy-pager-label"><ArrowLeft :size="14" />上一篇</span><span class="yy-pager-title">{{ titleOf(view.prev) }}</span>
        </RouterLink>
        <RouterLink v-if="view.next" :to="`/docs/${view.next.id}`" class="next">
          <span class="yy-pager-label">下一篇<ArrowRight :size="14" /></span><span class="yy-pager-title">{{ titleOf(view.next) }}</span>
        </RouterLink>
      </nav>
    </article>
    <aside v-if="view.toc.length" class="yy-doc-aside">
      <Toc :items="view.toc" @navigate="tocOpen = false" />
    </aside>
    <div v-if="tocOpen" class="yy-aside-mask" @click="tocOpen = false"></div>
  </main>
</template>
