<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { BookOpen, ChevronRight, Folder } from 'lucide-vue-next'
import { api, errorMessage, type Book } from '../../shared/api'
import { bookToGroupRequest } from '../actions'
import * as store from '../store'

const request = bookToGroupRequest.value!
const source = ref(request.book)
const rootIds = ref<number[]>([])
const groupId = ref<string | null>(null)
const bookId = ref<number | null>(null)
const loading = ref(true), failure = ref('')
let sequence = 0
onBeforeUnmount(() => { sequence++ })

const sections = computed(() => store.bookSections.value.map((g) => ({ ...g, books: g.books.filter((b) => b.id !== source.value.id) })).filter((g) => g.books.length))
const section = computed(() => sections.value.find((g) => g.id === groupId.value))
const target = computed(() => section.value?.books.find((b) => b.id === bookId.value))
const canSubmit = computed(() => !loading.value && !failure.value && !!target.value)

async function load() {
  const current = ++sequence
  loading.value = true
  failure.value = ''
  try {
    const [book, tree] = await Promise.all([api<Book>(`books/${source.value.id}`), store.loadTree(source.value.id, true), store.loadBooks(true)])
    if (current !== sequence) return
    source.value = book
    rootIds.value = tree.map((node) => node.id)
    groupId.value = sections.value[0]?.id ?? null
    bookId.value = null
  } catch (e) {
    if (current === sequence) failure.value = `加载失败：${errorMessage(e)}`
  } finally {
    if (current === sequence) loading.value = false
  }
}

function finish(ok: boolean) {
  if (ok && !canSubmit.value) return
  bookToGroupRequest.value = null
  request.resolve(ok ? { name: source.value.name, targetBookId: target.value!.id, rootIds: rootIds.value } : null)
}

void load()
</script>

<template>
  <DialogRoot :open="true" @update:open="(open) => !open && finish(false)">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-move-dialog yy-book-to-group" :aria-describedby="undefined">
        <DialogTitle class="yy-dialog-title">将“{{ source.name }}”转为分组</DialogTitle>
        <DialogDescription class="yy-dialog-message">选择目标知识库，全部文档和子分组将放入根目录下的同名分组，原有顺序与层级保留。原空知识库移入回收站。</DialogDescription>
        <div v-if="loading || failure || !sections.length" class="yy-convert-empty" role="status">
          <span>{{ loading ? '正在加载知识库…' : failure || '还没有其他知识库，请先新建一个目标知识库。' }}</span>
          <button v-if="failure" type="button" class="yy-btn" @click="load">重试</button>
        </div>
        <div v-else class="yy-move-body">
          <ul class="yy-move-books" aria-label="知识库分组">
            <li v-for="g in sections" :key="g.id">
              <button type="button" :class="{ selected: g.id === groupId }" @click="groupId = g.id; bookId = null"><Folder :size="15" /><span>{{ g.name }}</span><ChevronRight :size="13" /></button>
            </li>
          </ul>
          <ul class="yy-move-targets" aria-label="目标知识库">
            <li v-for="b in section?.books ?? []" :key="b.id">
              <button type="button" :class="{ selected: b.id === bookId }" @click="bookId = b.id"><BookOpen :size="15" /><span>{{ b.name }}</span></button>
            </li>
          </ul>
        </div>
        <p class="yy-dialog-message yy-convert-destination">{{ target ? `放入“${target.name}”的根目录` : '请选择目标知识库' }}</p>
        <div class="yy-dialog-actions">
          <button type="button" class="yy-btn" @click="finish(false)">取消</button>
          <button type="button" class="yy-btn primary" :disabled="!canSubmit" @click="finish(true)">转为分组</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.yy-book-to-group .yy-move-body, .yy-convert-empty { margin-top: 16px; height: min(300px, 40vh); }
.yy-convert-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--yy-text-3); font-size: 13px; text-align: center; }
.yy-move-body button { transition: background-color 140ms ease, color 140ms ease; }
.yy-move-body button span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.yy-move-body .lucide { flex-shrink: 0; }
.yy-convert-destination { overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .yy-book-to-group { top: 5vh; max-height: 90dvh; overflow: auto; }
  .yy-book-to-group .yy-move-body { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); grid-template-rows: 1fr; }
  .yy-move-books { border-right: 1px solid var(--yy-border); border-bottom: 0; }
  .yy-move-body button { padding: 7px; gap: 6px; }
}
</style>
