<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { BookOpen, ChevronRight, Ellipsis, FileText, FolderInput, FolderPlus, GripVertical, Plus } from 'lucide-vue-next'
import { api, errorMessage, type DocSummary } from '../../shared/api'
import { toast } from '../../ui/toast'
import { bookMenu, bookGroupMenu, moveBookGroup, newBook, newBookGroup } from '../actions'
import ActionMenu from '../../ui/ActionMenu.vue'
import IconButton from '../../ui/IconButton.vue'
import { closedBookGroups, toggleBookGroup } from '../bookGroups'
import { bookColor } from '../bookColor'
import { createBookDragMotion } from '../bookDragMotion'
import { recentlyViewed } from '../prefs'
import { setTitle } from '../router'
import { bookSections, loadBooks, loading, saveBookGroups, setPage, state } from '../store'
import { fromNow } from '../time'

setPage(null)
setTitle()

const viewed = ref(recentlyViewed())
const edited = ref<DocSummary[]>([])
const stats = ref<{ chars: number; bookChars: Record<number, number> } | null>(null)
const tab = ref<'viewed' | 'edited'>(viewed.value.length ? 'viewed' : 'edited')
const dragId = ref<number | null>(null)
const dragGroupId = ref<string | null>(null)
const overId = ref<number | null>(null)
const bookOrderSide = ref<'before' | 'after'>('before')
const overGroupId = ref<string | null>(null)
const draggedGroupId = ref<string | null>(null)
const groupOrderTarget = ref<string | null>(null)
const groupOrderSide = ref<'before' | 'after'>('before')
const settlingDrop = ref(false)
const home = ref<HTMLElement | null>(null)
const dragMotion = createBookDragMotion(() => home.value)
onBeforeUnmount(() => dragMotion.dispose())

function resetDrag() {
  dragMotion.clearPreview()
  dragId.value = overId.value = null
  dragGroupId.value = overGroupId.value = null
  draggedGroupId.value = groupOrderTarget.value = null
}

function finishDrop() {
  const land = dragMotion.captureDrop(dragId.value)
  // Commit immediately, then animate from the final layout without carrying the dropped card
  // through its source group or the containing group's previous position.
  settlingDrop.value = true
  resetDrag()
  void nextTick(() => { land(); settlingDrop.value = false })
}

function startGroupDrag(event: DragEvent, groupId: string) {
  if (!groupId) { event.preventDefault(); return }
  resetDrag()
  dragMotion.dispose()
  draggedGroupId.value = groupId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-yuyan-book-group', groupId)
  }
}

function startDrag(event: DragEvent, bookId: number, groupId: string) {
  resetDrag()
  dragMotion.start(event)
  dragId.value = bookId
  dragGroupId.value = groupId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-yuyan-book', String(bookId))
  }
}

function dragOver(event: DragEvent, groupId: string, bookId: number | null = null) {
  if (draggedGroupId.value !== null) {
    if (!groupId || groupId === draggedGroupId.value) { groupOrderTarget.value = null; return }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const group = (event.currentTarget as HTMLElement).closest('[data-book-group]')!
    const rect = group.getBoundingClientRect()
    groupOrderTarget.value = groupId
    groupOrderSide.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    return
  }
  if (dragId.value === null) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  overGroupId.value = groupId !== dragGroupId.value ? groupId : null
  overId.value = bookId
  if (bookId !== null) bookOrderSide.value = cardSide(event)
}

function cardSide(event: DragEvent): 'before' | 'after' {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
}

function leaveGroup(event: DragEvent, groupId: string) {
  const group = event.currentTarget as HTMLElement
  // Moving between the heading, a card and its controls stays inside this drop target.
  if (event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return
  if (overGroupId.value === groupId) overGroupId.value = null
  if (groupOrderTarget.value === groupId) groupOrderTarget.value = null
  overId.value = null
}

async function dropGroup(groupId: string) {
  const from = draggedGroupId.value
  const side = groupOrderSide.value
  const target = groupOrderTarget.value
  resetDrag()
  if (!from || !groupId || from === groupId || target !== groupId) return
  const moved = state.bookGroups.groups.find((g) => g.id === from)
  if (!moved) return
  const groups = state.bookGroups.groups.filter((g) => g.id !== from)
  const index = groups.findIndex((g) => g.id === groupId)
  if (index < 0) return
  groups.splice(index + (side === 'after' ? 1 : 0), 0, moved)
  if (groups.every((g, i) => g.id === state.bookGroups.groups[i]?.id)) return
  try {
    await saveBookGroups(groups)
  } catch (e) {
    toast(`分组排序失败：${errorMessage(e)}`, 'error')
  }
}

onMounted(async () => {
  try {
    await loading(Promise.all([loadBooks(), api<DocSummary[]>('recent').then((r) => (edited.value = r))]))
  } catch (e) {
    toast(`加载失败：${errorMessage(e)}`, 'error')
  }
})

// Refresh on entry and after home-page book changes, including moving a book to the trash.
watch(() => state.booksLoaded ? state.books : null, async (books, _, onCleanup) => {
  if (!books) return
  let active = true
  onCleanup(() => { active = false })
  try {
    const result = await api<NonNullable<typeof stats.value>>('stats')
    if (active) stats.value = result
  } catch (e) {
    if (!active) return
    stats.value = null
    toast(`字数统计加载失败：${errorMessage(e)}`, 'error')
  }
}, { immediate: true })

// The same left/right insertion target applies within a group and across groups.
async function dropOn(event: DragEvent, target: number, groupId: string) {
  if (draggedGroupId.value !== null) return dropGroup(groupId)
  const from = dragId.value
  const side = cardSide(event)
  finishDrop()
  if (from == null || from === target) return
  await moveBookGroup(from, groupId, { bookId: target, side })
}
async function dropInGroup(groupId: string) {
  if (draggedGroupId.value !== null) return dropGroup(groupId)
  const from = dragId.value
  finishDrop()
  if (from !== null) await moveBookGroup(from, groupId)
}
</script>

<template>
  <main ref="home" class="yy-page yy-home" :class="{ 'settling-drop': settlingDrop }">
    <section>
      <div class="yy-section-bar">
        <h2>知识库</h2>
        <div class="yy-section-actions">
          <button type="button" class="yy-btn" @click="newBookGroup()"><FolderPlus :size="15" />新建分组</button>
          <button type="button" class="yy-btn" @click="newBook()"><Plus :size="15" />新建知识库</button>
        </div>
      </div>
      <TransitionGroup tag="div" name="yy-book-groups" :css="!settlingDrop">
        <section v-for="group in bookSections" :key="group.id" class="yy-book-group" :class="{ 'drop-over': overGroupId === group.id, 'group-dragging': draggedGroupId === group.id, 'drop-before': groupOrderTarget === group.id && groupOrderSide === 'before', 'drop-after': groupOrderTarget === group.id && groupOrderSide === 'after' }" :data-book-group="group.id" @dragenter="dragOver($event, group.id)" @dragover="dragOver($event, group.id)" @dragleave="leaveGroup($event, group.id)" @drop.prevent="dropInGroup(group.id)">
          <div v-if="state.bookGroups.groups.length" class="yy-book-group-head" :draggable="!!group.id" @dragstart.stop="startGroupDrag($event, group.id)" @dragend="resetDrag">
            <GripVertical v-if="group.id" :size="14" class="yy-book-group-grip" data-tip="拖动调整分组顺序" aria-hidden="true" />
            <button type="button" class="yy-book-group-toggle" :aria-expanded="!closedBookGroups.has(group.id)" @click="toggleBookGroup(group.id)">
              <ChevronRight :size="16" :class="{ expanded: !closedBookGroups.has(group.id) }" /><span>{{ group.name }}</span><span class="yy-group-count">{{ group.books.length }}</span>
            </button>
            <ActionMenu v-if="group.id" :items="bookGroupMenu(group.id)"><IconButton small :label="group.name + '分组操作'"><Ellipsis :size="16" /></IconButton></ActionMenu>
            <span v-if="overGroupId === group.id" class="yy-book-group-drop-hint"><FolderInput :size="14" />松开以移入此分组</span>
          </div>
          <div class="yy-book-group-content" :class="{ collapsed: state.bookGroups.groups.length > 0 && closedBookGroups.has(group.id) }" :inert="state.bookGroups.groups.length > 0 && closedBookGroups.has(group.id)">
            <div class="yy-book-group-clip">
              <TransitionGroup tag="div" name="yy-book-list" class="yy-book-grid" :css="!settlingDrop">
                <div v-for="b in group.books" :key="b.id" :data-book-id="b.id" class="yy-book-card" :class="{ dragging: dragId === b.id, over: overId === b.id && dragId !== b.id, 'drop-before': overId === b.id && dragId !== b.id && bookOrderSide === 'before', 'drop-after': overId === b.id && dragId !== b.id && bookOrderSide === 'after' }" :style="bookColor(b.id)" draggable="true"
                  @dragstart="startDrag($event, b.id, group.id)" @dragenter.stop="dragOver($event, group.id, b.id)" @dragover.stop="dragOver($event, group.id, b.id)" @drop.prevent.stop="dropOn($event, b.id, group.id)" @dragend="resetDrag">
                  <RouterLink :to="`/books/${b.id}`" class="yy-book-card-link" :aria-label="b.name" draggable="false" />
                  <span class="yy-book-icon"><BookOpen :size="18" /></span>
                  <span class="yy-book-card-name">{{ b.name }}</span>
                  <span class="yy-book-card-desc">{{ b.description || '暂无简介' }}</span>
                  <span class="yy-book-card-meta">
                    <span>{{ b.docCount }} 篇文档</span>
                    <span v-if="stats && stats.bookChars[b.id] !== undefined" class="yy-book-card-chars">{{ stats.bookChars[b.id].toLocaleString('zh-CN') }} 字</span>
                  </span>
                  <ActionMenu :items="bookMenu(b, { receive: true, create: false })"><IconButton small class="yy-book-card-menu" :label="b.name + '知识库操作'"><Ellipsis :size="16" /></IconButton></ActionMenu>
                </div>
                <button v-if="!group.id" key="add" type="button" class="yy-book-card add" @click="newBook()"><Plus :size="20" />新建知识库</button>
                <p v-else-if="!group.books.length" key="empty" class="yy-book-group-empty">拖动知识库到这里，或通过知识库菜单移入</p>
              </TransitionGroup>
            </div>
          </div>
        </section>
      </TransitionGroup>
      <p v-if="stats" class="yy-home-stats">共 {{ stats.chars.toLocaleString('zh-CN') }} 字</p>
    </section>

    <section data-book-recent>
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
