<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { BookOpen, FileText, Trash2 } from 'lucide-vue-next'
import { api, errorMessage, type TrashItem } from '../../shared/api'
import { confirm } from '../../ui/dialog'
import { toast } from '../../ui/toast'
import { setTitle } from '../router'
import { loadBooks, loading, setPage, state } from '../store'
import { formatTime } from '../time'

setPage(null)
setTitle('回收站')

const items = ref<TrashItem[]>([])
const loaded = ref(false)

async function load() {
  try {
    items.value = await loading(api<TrashItem[]>('trash'))
    loaded.value = true
  } catch (e) {
    toast(`加载失败：${errorMessage(e)}`, 'error')
  }
}
onMounted(load)

// Restoring or deleting changes trees that may be cached; they reload when next shown.
async function changed() {
  for (const key of Object.keys(state.trees)) delete state.trees[Number(key)]
  await Promise.all([load(), loadBooks(true)])
}

async function restore(item: TrashItem) {
  try {
    await api(`${item.kind === 'book' ? 'books' : 'docs'}/${item.id}/restore`, { method: 'POST' })
    toast(`已恢复“${item.title}”`, 'success')
    await changed()
  } catch (e) {
    toast(`恢复失败：${errorMessage(e)}`, 'error')
  }
}

async function purge(item: TrashItem) {
  const ok = await confirm({
    title: `彻底删除“${item.title}”？`,
    message: item.kind === 'book' ? '知识库和其中的全部文档、历史版本都会被删除，无法恢复。' : '文档、它下面一起删除的内容和历史版本都会被删除，无法恢复。',
    confirmText: '彻底删除',
    danger: true,
  })
  if (!ok) return
  try {
    await api(`trash/${item.kind === 'book' ? 'books' : 'docs'}/${item.id}`, { method: 'DELETE' })
    toast('已彻底删除', 'success')
    await changed()
  } catch (e) {
    toast(`删除失败：${errorMessage(e)}`, 'error')
  }
}

async function empty() {
  const ok = await confirm({ title: '清空回收站？', message: `回收站里的 ${items.value.length} 项及其历史版本都会被删除，无法恢复。`, confirmText: '清空', danger: true })
  if (!ok) return
  try {
    await api('trash', { method: 'DELETE' })
    toast('回收站已清空', 'success')
    await changed()
  } catch (e) {
    toast(`清空失败：${errorMessage(e)}`, 'error')
  }
}
</script>

<template>
  <Teleport defer to="#yy-topbar-actions">
    <button v-if="items.length" type="button" class="yy-btn danger-text" @click="empty"><Trash2 :size="15" />清空回收站</button>
  </Teleport>
  <main class="yy-page yy-narrow">
    <h1 class="yy-page-title">回收站</h1>
    <p class="yy-page-sub">删除的知识库和文档会一直留在这里，直到彻底删除。图片文件不会随之删除。</p>
    <ul v-if="items.length" class="yy-trash-list">
      <li v-for="item in items" :key="`${item.kind}-${item.id}`">
        <component :is="item.kind === 'book' ? BookOpen : FileText" :size="18" class="yy-trash-icon" />
        <div class="yy-trash-text">
          <span class="yy-trash-title">{{ item.title }}</span>
          <span class="yy-trash-sub">{{ item.kind === 'book' ? '知识库' : item.bookName }} · 删除于 {{ formatTime(item.deletedAt) }}</span>
        </div>
        <button type="button" class="yy-btn small" @click="restore(item)">恢复</button>
        <button type="button" class="yy-btn small danger-text" @click="purge(item)">彻底删除</button>
      </li>
    </ul>
    <div v-else-if="loaded" class="yy-empty-state small">
      <Trash2 :size="36" :stroke-width="1.25" />
      <p>回收站是空的</p>
    </div>
  </main>
</template>
