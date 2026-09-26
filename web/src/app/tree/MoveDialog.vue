<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { BookOpen, FileText, Folder } from 'lucide-vue-next'
import type { TreeNode } from '../../shared/api'
import { moveRequest } from '../actions'
import * as store from '../store'

// Picks where "移动到…" puts a document: a knowledge base and a parent inside it. The document
// and everything under it are not offered, since nothing can move into its own subtree.

const bookId = ref<number | null>(null)
const parentId = ref<number | null>(null)
const request = computed(() => moveRequest.value)

watch(request, (r) => {
  if (!r) return
  bookId.value = r.bookId
  parentId.value = store.locate(r.bookId, r.node.id)?.parent?.id ?? null
})

watch(bookId, (id, old) => {
  if (id == null) return
  if (old != null) parentId.value = null
  void store.loadTree(id)
})

const rows = computed(() => {
  const r = request.value
  const tree = bookId.value == null ? undefined : store.state.trees[bookId.value]
  if (!r || !tree) return []
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (n.id === r.node.id) continue
      out.push({ node: n, depth })
      walk(n.children ?? [], depth + 1)
    }
  }
  walk(tree, 0)
  return out
})

function finish(ok: boolean) {
  const r = request.value
  if (!r) return
  moveRequest.value = null
  r.resolve(ok && bookId.value != null ? { bookId: bookId.value, parentId: parentId.value } : null)
}
</script>

<template>
  <DialogRoot :open="!!request" @update:open="(open) => !open && finish(false)">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent v-if="request" class="yy-dialog yy-move-dialog" :aria-describedby="undefined">
        <DialogTitle class="yy-dialog-title">把“{{ request.node.title }}”移动到</DialogTitle>
        <div class="yy-move-body">
          <ul class="yy-move-books">
            <li v-for="b in store.state.books" :key="b.id">
              <button type="button" :class="{ selected: b.id === bookId }" @click="bookId = b.id"><BookOpen :size="15" />{{ b.name }}</button>
            </li>
          </ul>
          <ul class="yy-move-targets">
            <li>
              <button type="button" :class="{ selected: parentId === null }" @click="parentId = null">
                <BookOpen :size="15" />知识库的顶层
              </button>
            </li>
            <li v-for="{ node, depth } in rows" :key="node.id">
              <button type="button" :class="{ selected: parentId === node.id }" :style="{ paddingLeft: `${12 + (depth + 1) * 16}px` }" @click="parentId = node.id">
                <component :is="node.kind === 'group' ? Folder : FileText" :size="15" />{{ node.title }}
              </button>
            </li>
          </ul>
        </div>
        <p class="yy-dialog-message">子文档会一起移动，放在所选位置的最后。</p>
        <div class="yy-dialog-actions">
          <button type="button" class="yy-btn" @click="finish(false)">取消</button>
          <button type="button" class="yy-btn primary" @click="finish(true)">移动</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
