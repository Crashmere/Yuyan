<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { BookOpen, ChevronsUpDown, Ellipsis, Plus } from 'lucide-vue-next'
import ActionMenu from '../../ui/ActionMenu.vue'
import FoldAllButton from '../../ui/FoldAllButton.vue'
import IconButton from '../../ui/IconButton.vue'
import type { MenuEntry } from '../../ui/menu'
import { bookMenu, newDoc } from '../actions'
import { bookOf, loadBooks, loadTree, state } from '../store'
import BookTree from '../tree/BookTree.vue'

const props = defineProps<{ bookId: number }>()
const route = useRoute()
const router = useRouter()
const book = computed(() => bookOf(props.bookId))
const tree = computed(() => state.trees[props.bookId])
const treeView = ref<InstanceType<typeof BookTree> | null>(null)
const switcher = computed<MenuEntry[]>(() =>
  state.books.map((b) => ({ label: b.name, icon: BookOpen, disabled: b.id === props.bookId, run: () => void router.push(`/books/${b.id}`) })),
)

onMounted(() => {
  void loadBooks()
  void loadTree(props.bookId)
})
</script>

<template>
  <div class="yy-sidebar-body">
    <div v-if="book" class="yy-book-head">
      <RouterLink :to="`/books/${book.id}`" class="yy-book-name" :class="{ active: route.name === 'book' }" :title="book.name">
        <BookOpen :size="16" /><span>{{ book.name }}</span>
      </RouterLink>
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
        <FoldAllButton v-if="treeView?.hasBranches" :expanded="treeView.hasExpanded" @click="treeView.toggleAll()" />
      </div>
      <BookTree v-if="tree" ref="treeView" :book-id="bookId" :nodes="tree" :current-id="state.docId" />
    </div>
  </div>
</template>
