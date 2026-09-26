<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { BookOpen, Ellipsis, FilePlus } from 'lucide-vue-next'
import { api, ApiError, errorMessage, type Book, type TreeNode } from '../../shared/api'
import ActionMenu from '../../ui/ActionMenu.vue'
import IconButton from '../../ui/IconButton.vue'
import { bookMenu, editBookDescription, newDoc } from '../actions'
import { bookColor } from '../bookColor'
import { setTitle } from '../router'
import { bookOf, loadBooks, loading, loadTree, setPage, state } from '../store'
import { fromNow } from '../time'
import CatalogList from './CatalogList.vue'
import NotFoundState from './NotFoundState.vue'

const route = useRoute()
const id = Number(route.params.id)
const missing = ref(false)
const failure = ref('')
const fetched = ref<Book | null>(null)
// The list in the store stays current after renames; the fetched copy covers the first paint.
const book = computed(() => bookOf(id) ?? fetched.value)
const tree = computed(() => state.trees[id])

function latest(nodes: TreeNode[]): string {
  return nodes.reduce((max, n) => {
    const child = latest(n.children ?? [])
    const own = n.kind === 'doc' ? n.updatedAt : ''
    return [max, own, child].reduce((a, b) => (b > a ? b : a))
  }, '')
}
const updated = computed(() => (tree.value ? latest(tree.value) : ''))

onMounted(async () => {
  try {
    fetched.value = await loading(api<Book>(`books/${id}`))
    setPage(id)
    setTitle(fetched.value.name)
    await Promise.all([loadBooks(), loadTree(id)])
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
    <template v-if="book && !missing">
      <button type="button" class="yy-btn primary" @click="newDoc(id, null)"><FilePlus :size="15" />新建文档</button>
      <ActionMenu :items="bookMenu(book)"><IconButton label="知识库操作"><Ellipsis :size="18" /></IconButton></ActionMenu>
    </template>
  </Teleport>

  <main v-if="missing" class="yy-page"><NotFoundState /></main>
  <main v-else-if="failure" class="yy-page"><p class="yy-page-error">加载失败：{{ failure }}</p></main>
  <main v-else-if="book" class="yy-page yy-book-home">
    <header class="yy-book-hero" :style="bookColor(book.id)">
      <span class="yy-book-icon large"><BookOpen :size="26" /></span>
      <div class="yy-book-hero-text">
        <h1>{{ book.name }}</h1>
        <button type="button" class="yy-book-desc" :class="{ empty: !book.description }" @click="editBookDescription(book)">
          {{ book.description || '添加简介' }}
        </button>
        <p class="yy-book-stats">
          {{ book.docCount }} 篇文档<template v-if="updated"> · 最近更新 {{ fromNow(updated) }}</template>
        </p>
      </div>
    </header>
    <section class="yy-book-catalog">
      <h2>目录</h2>
      <CatalogList v-if="tree?.length" :nodes="tree" />
      <div v-else-if="tree" class="yy-empty-inline">
        这个知识库还没有文档。<button type="button" class="yy-link-btn" @click="newDoc(id, null)">新建第一篇</button>
      </div>
    </section>
  </main>
</template>
