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
const verb = computed(() => request.value?.action === 'copy' ? '复制' : '移动')
const failure = ref('')
const loading = ref(false)
let loadSequence = 0

async function loadDestination(id: number) {
  const sequence = ++loadSequence
  failure.value = ''
  loading.value = true
  try { await store.loadTree(id) }
  catch { if (sequence === loadSequence) failure.value = '目录加载失败，请重新选择知识库' }
  finally { if (sequence === loadSequence) loading.value = false }
}

function chooseBook(id: number) {
  bookId.value = id
  parentId.value = null
  void loadDestination(id)
}

watch(request, (r) => {
  if (!r) { loadSequence++; return }
  bookId.value = r.bookId
  parentId.value = r.nodes ? null : store.locate(r.bookId, r.node.id)?.parent?.id ?? null
  void loadDestination(r.bookId)
})

const rows = computed(() => {
  const r = request.value
  const tree = bookId.value == null ? undefined : store.state.trees[bookId.value]
  if (!r || !tree) return []
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (r.action !== 'copy' && (r.nodes ?? [r.node]).some((selected) => selected.id === n.id)) continue
      out.push({ node: n, depth })
      walk(n.children ?? [], depth + 1)
    }
  }
  walk(tree, 0)
  return out
})

watch(rows, (items) => {
  if (parentId.value != null && !items.some(({ node }) => node.id === parentId.value)) parentId.value = null
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
        <DialogTitle class="yy-dialog-title">{{ verb }}{{ request.count ? ` ${request.count} 项到` : `“${request.node.title}”到` }}</DialogTitle>
        <div class="yy-move-body">
          <ul class="yy-move-books">
            <li v-for="b in store.state.books" :key="b.id">
              <button type="button" :class="{ selected: b.id === bookId }" @click="chooseBook(b.id)"><BookOpen :size="15" />{{ b.name }}</button>
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
        <p class="yy-dialog-message">{{ failure || (loading ? '正在加载目录…' : `子文档会一起${verb}，放在所选位置的最后。`) }}</p>
        <div class="yy-dialog-actions">
          <button type="button" class="yy-btn" @click="finish(false)">取消</button>
          <button type="button" class="yy-btn primary" :disabled="loading || !!failure || bookId == null" @click="finish(true)">{{ verb }}</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
