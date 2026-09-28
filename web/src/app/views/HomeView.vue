<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { BookOpen, ChevronRight, Ellipsis, FileText, FolderPlus, Plus } from 'lucide-vue-next'
import { api, errorMessage, type DocSummary } from '../../shared/api'
import { toast } from '../../ui/toast'
import { bookGroupChoices, bookGroupMenu, moveBookGroup, newBook, newBookGroup } from '../actions'
import ActionMenu from '../../ui/ActionMenu.vue'
import IconButton from '../../ui/IconButton.vue'
import { closedBookGroups, toggleBookGroup } from '../bookGroups'
import { bookColor } from '../bookColor'
import { recentlyViewed } from '../prefs'
import { setTitle } from '../router'
import { bookSections, loadBooks, loading, reorderBooks, setPage, state } from '../store'
import { fromNow } from '../time'

setPage(null)
setTitle()

const viewed = ref(recentlyViewed())
const edited = ref<DocSummary[]>([])
const tab = ref<'viewed' | 'edited'>(viewed.value.length ? 'viewed' : 'edited')
const dragId = ref<number | null>(null)
const overId = ref<number | null>(null)

onMounted(async () => {
  try {
    await loading(Promise.all([loadBooks(), api<DocSummary[]>('recent').then((r) => (edited.value = r))]))
  } catch (e) {
    toast(`加载失败：${errorMessage(e)}`, 'error')
  }
})

// Dropping a card on another puts it in that card's place: after the target when moving
// forward, before it when moving back.
async function dropOn(target: number, groupId: string) {
  const from = dragId.value
  dragId.value = overId.value = null
  if (from == null || from === target) return
  const oldGroup = state.bookGroups.groups.find((g) => g.bookIds.includes(from))?.id ?? ''
  if (oldGroup !== groupId) { await moveBookGroup(from, groupId); return }
  const forward = state.books.findIndex((b) => b.id === from) < state.books.findIndex((b) => b.id === target)
  const moved = state.books.find((b) => b.id === from)!
  const books = state.books.filter((b) => b.id !== from)
  books.splice(books.findIndex((b) => b.id === target) + (forward ? 1 : 0), 0, moved)
  state.books = books
  try {
    await reorderBooks(books.map((b) => b.id))
  } catch (e) {
    toast(`排序失败：${errorMessage(e)}`, 'error')
  }
}
async function dropInGroup(groupId: string) {
  const from = dragId.value
  dragId.value = overId.value = null
  if (from !== null) await moveBookGroup(from, groupId)
}
</script>

<template>
  <main class="yy-page yy-home">
    <section>
      <div class="yy-section-bar">
        <h2>知识库</h2>
        <div class="yy-section-actions">
          <button type="button" class="yy-btn" @click="newBookGroup()"><FolderPlus :size="15" />新建分组</button>
          <button type="button" class="yy-btn" @click="newBook"><Plus :size="15" />新建知识库</button>
        </div>
      </div>
      <section v-for="group in bookSections" :key="group.id" class="yy-book-group" :data-book-group="group.id" @dragover.prevent @drop.prevent="dropInGroup(group.id)">
        <div v-if="state.bookGroups.groups.length" class="yy-book-group-head">
          <button type="button" class="yy-book-group-toggle" :aria-expanded="!closedBookGroups.has(group.id)" @click="toggleBookGroup(group.id)">
            <ChevronRight :size="16" :class="{ expanded: !closedBookGroups.has(group.id) }" /><span>{{ group.name }}</span><span class="yy-group-count">{{ group.books.length }}</span>
          </button>
          <ActionMenu v-if="group.id" :items="bookGroupMenu(group.id)"><IconButton small :label="group.name + '分组操作'"><Ellipsis :size="16" /></IconButton></ActionMenu>
        </div>
        <div v-if="!state.bookGroups.groups.length || !closedBookGroups.has(group.id)" class="yy-book-grid">
          <div v-for="b in group.books" :key="b.id" class="yy-book-card" :class="{ dragging: dragId === b.id, over: overId === b.id && dragId !== b.id }" :style="bookColor(b.id)" draggable="true"
            @dragstart="dragId = b.id" @dragover.prevent.stop="overId = b.id" @dragleave="overId === b.id && (overId = null)" @drop.prevent.stop="dropOn(b.id, group.id)" @dragend="dragId = overId = null">
            <RouterLink :to="`/books/${b.id}`" class="yy-book-card-link" :aria-label="b.name" draggable="false" />
            <span class="yy-book-icon"><BookOpen :size="18" /></span>
            <span class="yy-book-card-name">{{ b.name }}</span>
            <span class="yy-book-card-desc">{{ b.description || '暂无简介' }}</span>
            <span class="yy-book-card-meta">{{ b.docCount }} 篇文档</span>
            <ActionMenu :items="bookGroupChoices(b.id)"><IconButton small class="yy-book-card-menu" :label="b.name + '移至分组'"><Ellipsis :size="16" /></IconButton></ActionMenu>
          </div>
          <button v-if="!group.id" type="button" class="yy-book-card add" @click="newBook"><Plus :size="20" />新建知识库</button>
          <p v-else-if="!group.books.length" class="yy-book-group-empty">拖动知识库到这里，或通过知识库菜单移入</p>
        </div>
      </section>
    </section>

    <section>
      <div class="yy-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'viewed'" :class="{ active: tab === 'viewed' }" @click="tab = 'viewed'">最近浏览</button>
        <button type="button" role="tab" :aria-selected="tab === 'edited'" :class="{ active: tab === 'edited' }" @click="tab = 'edited'">最近编辑</button>
      </div>
      <ul v-if="tab === 'viewed'" class="yy-doc-list">
        <li v-for="d in viewed" :key="d.id">
          <RouterLink :to="`/docs/${d.id}`"><FileText :size="16" /><span class="yy-doc-list-title">{{ d.title }}</span></RouterLink>
          <span class="yy-doc-list-book">{{ d.bookName }}</span>
          <span class="yy-doc-list-time">{{ fromNow(d.at) }}</span>
        </li>
        <li v-if="!viewed.length" class="yy-doc-list-empty">还没有浏览过的文档，打开过的文档会出现在这里</li>
      </ul>
      <ul v-else class="yy-doc-list">
        <li v-for="d in edited" :key="d.id">
          <RouterLink :to="`/docs/${d.id}`"><FileText :size="16" /><span class="yy-doc-list-title">{{ d.title }}</span></RouterLink>
          <span class="yy-doc-list-book">{{ d.bookName }}</span>
          <span class="yy-doc-list-time">{{ fromNow(d.updatedAt) }}</span>
        </li>
        <li v-if="!edited.length" class="yy-doc-list-empty">还没有文档</li>
      </ul>
    </section>
  </main>
</template>
