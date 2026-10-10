<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { BookOpen, ChevronsUpDown, Copy, Download, Ellipsis, Folder, FolderInput, Link, Plus, Trash2 } from 'lucide-vue-next'
import { errorMessage } from '../../shared/api'
import { toast } from '../../ui/toast'
import ActionMenu from '../../ui/ActionMenu.vue'
import ContextActions from '../../ui/ContextActions.vue'
import FoldAllButton from '../../ui/FoldAllButton.vue'
import IconButton from '../../ui/IconButton.vue'
import type { MenuEntry } from '../../ui/menu'
import { bookCreateMenu, bookMenu } from '../actions'
import { bookOf, bookSections, loadBooks, loadTree, state } from '../store'
import BookTree from '../tree/BookTree.vue'
import { runBatch, type BatchAction } from '../tree/batch'

const props = defineProps<{ bookId: number }>()
const route = useRoute()
const router = useRouter()
const book = computed(() => bookOf(props.bookId))
const tree = computed(() => state.trees[props.bookId])
const treeView = ref<InstanceType<typeof BookTree> | null>(null)
const selecting = computed(() => !!treeView.value?.selecting)
const selectedCount = computed(() => treeView.value?.selectedNodes.length ?? 0)
const hasSelectedDocs = computed(() => treeView.value?.selectedNodes.some((n) => n.kind === 'doc'))
const busy = ref(false)

async function batch(action: BatchAction) {
  const view = treeView.value
  if (!view || busy.value || !selectedCount.value) return
  busy.value = true
  try {
    if (await runBatch(action, props.bookId, [...view.selectedNodes], [...view.selectedRoots])) view.clearSelection()
  } catch (e) {
    toast(errorMessage(e), 'error')
  } finally { busy.value = false }
}

function escape(e: KeyboardEvent) {
  if (!selecting.value) return
  e.preventDefault()
  e.stopPropagation()
  if (!busy.value) treeView.value?.exitSelecting()
}
const switcher = computed<MenuEntry[]>(() => {
  const items = (books: typeof state.books) => books.map((b) => ({ label: b.name, icon: BookOpen, disabled: b.id === props.bookId, run: () => void router.push(`/books/${b.id}`) }))
  return state.bookGroups.groups.length
    ? bookSections.value.filter((g) => g.books.length).map((g) => ({ label: g.name, icon: Folder, children: items(g.books) }))
    : items(state.books)
})

onMounted(() => {
  // The book page loads both panels together and handles failures, including a missing book.
  if (route.name === 'book') return
  void loadBooks()
  void loadTree(props.bookId)
})
</script>

<template>
  <div class="yy-sidebar-body" :class="{ 'yy-batch-mode': selecting }" @keydown.esc="escape">
    <div v-if="book" class="yy-book-head">
      <template v-if="selecting">
        <label class="yy-batch-all">
          <input type="checkbox" class="yy-tree-check" aria-label="全选目录" :checked="treeView?.selectionState === true"
            :indeterminate="treeView?.selectionState === 'mixed'" :disabled="busy" @change="treeView?.selectAll()" />
          <span :title="book.name">{{ book.name }}</span>
        </label>
        <button type="button" class="yy-batch-exit" :disabled="busy" @click="treeView?.exitSelecting()">退出</button>
      </template>
      <template v-else>
        <ContextActions :items="bookMenu(book)">
          <RouterLink :to="`/books/${book.id}`" class="yy-book-name" :class="{ active: route.name === 'book' }" :title="book.name">
            <span>{{ book.name }}</span>
          </RouterLink>
        </ContextActions>
        <ActionMenu :items="switcher" align="start">
          <IconButton small label="切换知识库"><ChevronsUpDown :size="14" /></IconButton>
        </ActionMenu>
        <ActionMenu :items="bookMenu(book)">
          <IconButton small label="知识库操作"><Ellipsis :size="15" /></IconButton>
        </ActionMenu>
        <ActionMenu :items="bookCreateMenu(book.id)">
          <IconButton small label="新建"><Plus :size="15" /></IconButton>
        </ActionMenu>
      </template>
    </div>
    <div class="yy-tree-scroll">
      <div v-if="tree?.length" class="yy-tree-head">
        <span>目录</span>
        <IconButton v-if="!selecting" small label="批量操作" @click="treeView?.startSelecting()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="5" cy="7" r="2.5" /><circle cx="5" cy="17" r="2.5" /><path d="M12 7h9M12 17h9" />
          </svg>
        </IconButton>
        <IconButton small label="定位当前文档" :disabled="!treeView?.canLocate" @click="treeView?.locateCurrent()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 1v6m0 10v6M1 12h6m10 0h6" />
          </svg>
        </IconButton>
        <FoldAllButton v-if="treeView?.hasBranches" :expanded="treeView.hasExpanded" @click="treeView.toggleAll()" />
      </div>
      <BookTree v-if="tree" ref="treeView" :book-id="bookId" :nodes="tree" :current-id="state.docId" :busy="busy" />
    </div>
    <section v-if="selecting" class="yy-batch-card" aria-label="批量操作" :aria-busy="busy">
      <div class="yy-batch-heading"><strong>批量操作</strong><span aria-live="polite">{{ busy ? '正在处理…' : `已选 ${selectedCount} 项` }}</span></div>
      <div class="yy-batch-actions">
        <IconButton label="复制文档" :disabled="busy || !selectedCount" @click="batch('copy')"><Copy :size="18" /></IconButton>
        <IconButton label="移动到…" :disabled="busy || !selectedCount" @click="batch('move')"><FolderInput :size="18" /></IconButton>
        <IconButton label="导出" :disabled="busy || !selectedCount" @click="batch('export')"><Download :size="18" /></IconButton>
        <IconButton label="复制链接" :disabled="busy || !hasSelectedDocs" @click="batch('links')"><Link :size="18" /></IconButton>
        <IconButton class="yy-batch-trash" label="移到回收站" :disabled="busy || !selectedCount" @click="batch('trash')"><Trash2 :size="18" /></IconButton>
      </div>
    </section>
  </div>
</template>
