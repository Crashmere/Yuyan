<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { BookOpen, ChevronsUpDown, Ellipsis, Folder, Plus } from 'lucide-vue-next'
import ActionMenu from '../../ui/ActionMenu.vue'
import ContextActions from '../../ui/ContextActions.vue'
import FoldAllButton from '../../ui/FoldAllButton.vue'
import IconButton from '../../ui/IconButton.vue'
import type { MenuEntry } from '../../ui/menu'
import { bookMenu, newDoc } from '../actions'
import { bookOf, bookSections, loadBooks, loadTree, state } from '../store'
import BookTree from '../tree/BookTree.vue'

const props = defineProps<{ bookId: number }>()
const route = useRoute()
const router = useRouter()
const book = computed(() => bookOf(props.bookId))
const tree = computed(() => state.trees[props.bookId])
const treeView = ref<InstanceType<typeof BookTree> | null>(null)
const switcher = computed<MenuEntry[]>(() => {
  const items = (books: typeof state.books) => books.map((b) => ({ label: b.name, icon: BookOpen, disabled: b.id === props.bookId, run: () => void router.push(`/books/${b.id}`) }))
  return state.bookGroups.groups.length
    ? bookSections.value.filter((g) => g.books.length).map((g) => ({ label: g.name, icon: Folder, children: items(g.books) }))
    : items(state.books)
})

onMounted(() => {
  void loadBooks()
  void loadTree(props.bookId)
})
</script>

<template>
  <div class="yy-sidebar-body">
    <div v-if="book" class="yy-book-head">
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
      <IconButton small label="新建文档" @click="newDoc(book.id, null)"><Plus :size="15" /></IconButton>
    </div>
    <div class="yy-tree-scroll">
      <div v-if="tree?.length" class="yy-tree-head">
        <span>目录</span>
        <IconButton small label="定位当前文档" :disabled="!treeView?.canLocate" @click="treeView?.locateCurrent()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 1v6m0 10v6M1 12h6m10 0h6" />
          </svg>
        </IconButton>
        <FoldAllButton v-if="treeView?.hasBranches" :expanded="treeView.hasExpanded" @click="treeView.toggleAll()" />
      </div>
      <BookTree v-if="tree" ref="treeView" :book-id="bookId" :nodes="tree" :current-id="state.docId" />
    </div>
  </div>
</template>
