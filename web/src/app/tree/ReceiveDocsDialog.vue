<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { BookOpen, ChevronRight, FileText, Folder } from 'lucide-vue-next'
import { errorMessage, type TreeNode } from '../../shared/api'
import { toast } from '../../ui/toast'
import { receiveDocsRequest } from '../actions'
import * as store from '../store'
import { useTreeSelection } from './selection'

const target = receiveDocsRequest.value!
const groupId = ref<string | null>(null)
const bookId = ref<number | null>(null)
const path = ref<TreeNode[]>([])
const browser = ref<HTMLElement | null>(null)
const loading = ref(false), saving = ref(false), failure = ref('')
const sourceReady = ref(false)
const activeColumn = ref(0)
let sequence = 0
let anchor: { parentId: number | null; id: number } | null = null
onBeforeUnmount(() => { sequence++ })

const sections = computed(() => store.bookSections.value.map((g) => ({ ...g, books: g.books.filter((b) => b.id !== target.id) })).filter((g) => g.books.length))
const group = computed(() => sections.value.find((g) => g.id === groupId.value))
const book = computed(() => group.value?.books.find((b) => b.id === bookId.value))
const nodes = computed(() => bookId.value === null || !sourceReady.value ? [] : store.state.trees[bookId.value] ?? [])
const selection = useTreeSelection(() => nodes.value, () => false)
const selectedNodes = selection.selectedNodes
const docsCount = computed(() => selectedNodes.value.filter((n) => n.kind === 'doc').length)
const groupsCount = computed(() => selectedNodes.value.length - docsCount.value)
const columns = computed(() => [
  { id: null as number | null, title: book.value?.name ?? '文档', nodes: nodes.value },
  ...path.value.map((node) => ({ id: node.id, title: node.title, nodes: node.children ?? [] })),
])
const canMove = computed(() => !saving.value && !loading.value && !!book.value && selectedNodes.value.length > 0 && selectedNodes.value.length <= 5000)

async function showColumn(index: number) {
  await nextTick()
  const frame = browser.value
  const column = frame?.children[index] as HTMLElement | undefined
  if (!frame || !column) return
  const left = column.offsetLeft - (frame.firstElementChild as HTMLElement).offsetLeft
  frame.scrollTo({ left: Math.max(0, left + column.offsetWidth - frame.clientWidth), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}

function chooseGroup(id: string) {
  if (saving.value) return
  sequence++
  groupId.value = id
  bookId.value = null
  path.value = []
  loading.value = false
  sourceReady.value = false
  failure.value = ''
  anchor = null
  selection.exit()
  void showColumn(1)
}

async function chooseBook(id: number) {
  if (saving.value) return
  const current = ++sequence
  bookId.value = id
  path.value = []
  anchor = null
  selection.exit()
  loading.value = true
  sourceReady.value = false
  failure.value = ''
  try {
    await store.loadTree(id, true)
    if (current === sequence) sourceReady.value = true
  }
  catch (e) { if (current === sequence) failure.value = `目录加载失败：${errorMessage(e)}` }
  finally {
    if (current === sequence) {
      loading.value = false
      activeColumn.value = 0
      void showColumn(2)
    }
  }
}

function browse(node: TreeNode, column: number) {
  if (saving.value) return
  path.value = [...path.value.slice(0, column), node]
  activeColumn.value = column + 1
  void showColumn(column + 3)
}

function select(node: TreeNode, column: number, event: MouseEvent, checkbox = false) {
  if (saving.value) return
  const current = columns.value[column]
  const range = event.shiftKey && anchor?.parentId === current.id
  const a = range ? current.nodes.findIndex((n) => n.id === anchor!.id) : -1
  const b = current.nodes.findIndex((n) => n.id === node.id)
  const items = a >= 0 ? current.nodes.slice(Math.min(a, b), Math.max(a, b) + 1) : [node]
  const additive = checkbox || event.metaKey || event.ctrlKey
  selection.setItems(items, event.shiftKey || !additive || selection.state(node) !== true, !additive)
  if (!event.shiftKey) anchor = { parentId: current.id, id: node.id }
  activeColumn.value = column
  if (!additive && !event.shiftKey) {
    if (node.kind === 'group' || node.children?.length) browse(node, column)
    else path.value = path.value.slice(0, column)
  }
}

function selectColumn() {
  const current = columns.value[activeColumn.value]
  if (!saving.value && !loading.value && current) selection.setItems(current.nodes, true)
}

function keydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !event.altKey && !event.isComposing) {
    event.preventDefault()
    selectColumn()
  }
}

function close() { if (!saving.value) receiveDocsRequest.value = null }

async function move() {
  if (!canMove.value || bookId.value === null) return
  saving.value = true
  failure.value = ''
  const count = selectedNodes.value.length
  try {
    const result = await store.batchDocs(bookId.value, selectedNodes.value.map((n) => n.id), 'move', { bookId: target.id, parentId: null })
    receiveDocsRequest.value = null
    toast(`已将 ${count} 项移入“${target.name}”${result.refreshed ? '' : '，请刷新页面以更新目录'}`, 'success')
  } catch (e) {
    failure.value = errorMessage(e)
    // Refreshed source data may have a different hierarchy. Let the user choose again.
    path.value = []
    activeColumn.value = 0
    anchor = null
    selection.exit()
    void showColumn(2)
  } finally { saving.value = false }
}
</script>

<template>
  <DialogRoot :open="true" @update:open="(open) => !open && close()">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-receive-dialog" :aria-describedby="undefined" @keydown="keydown"
        @escape-key-down="saving && $event.preventDefault()" @interact-outside="saving && $event.preventDefault()">
        <DialogTitle class="yy-dialog-title">从其他知识库移入</DialogTitle>
        <p class="yy-receive-destination">移入“{{ target.name }}”的根目录</p>
        <nav class="yy-receive-path" aria-label="当前位置">
          <button type="button" :disabled="saving" @click="showColumn(0)">知识库分组</button>
          <template v-if="group"><ChevronRight :size="12" /><button type="button" :disabled="saving" @click="showColumn(1)">{{ group.name }}</button></template>
          <template v-if="book"><ChevronRight :size="12" /><button type="button" :disabled="saving" @click="activeColumn = 0; showColumn(2)">{{ book.name }}</button></template>
          <template v-for="(node, i) in path" :key="node.id"><ChevronRight :size="12" /><button type="button" :disabled="saving" @click="activeColumn = i + 1; showColumn(i + 3)">{{ node.title }}</button></template>
        </nav>
        <div ref="browser" class="yy-receive-browser" :aria-busy="loading || saving">
          <section class="yy-receive-column" aria-label="知识库分组">
            <h3>知识库分组</h3>
            <ul>
              <li v-for="g in sections" :key="g.id"><button type="button" :disabled="saving" class="yy-receive-choice" :class="{ selected: g.id === groupId }" @click="chooseGroup(g.id)"><Folder :size="16" /><span>{{ g.name }}</span><ChevronRight :size="13" /></button></li>
            </ul>
            <p v-if="!sections.length" class="yy-receive-empty">还没有其他知识库</p>
          </section>
          <section class="yy-receive-column" aria-label="知识库">
            <h3>知识库</h3>
            <ul>
              <li v-for="b in group?.books ?? []" :key="b.id"><button type="button" :disabled="saving" class="yy-receive-choice" :class="{ selected: b.id === bookId }" @click="chooseBook(b.id)"><BookOpen :size="16" /><span>{{ b.name }}</span><ChevronRight :size="13" /></button></li>
            </ul>
            <p v-if="!group" class="yy-receive-empty">请选择知识库分组</p>
          </section>
          <section v-for="(column, index) in columns" :key="column.id ?? 'root'" class="yy-receive-column" :aria-label="column.title" :data-source-parent="column.id ?? 'root'" @pointerdown="activeColumn = index">
            <h3>{{ column.title }}</h3>
            <p v-if="index === 0 && (!book || loading || (failure && !nodes.length))" class="yy-receive-empty">
              {{ !book ? '请选择知识库' : loading ? '正在加载目录…' : failure }}
              <button v-if="book && !loading" type="button" class="yy-link-btn" @click="chooseBook(book.id)">重试</button>
            </p>
            <template v-else>
              <ul aria-label="文档列表">
                <li v-for="node in column.nodes" :key="node.id">
                  <div class="yy-receive-row" :class="{ selected: selection.state(node) === true, browsing: path[index]?.id === node.id }" :data-source-id="node.id" @click="select(node, index, $event)">
                    <input type="checkbox" class="yy-tree-check" :aria-label="`选择 ${node.title}`" :checked="selection.state(node) === true" :indeterminate="selection.state(node) === 'mixed'" :disabled="saving" @click.stop="select(node, index, $event, true)" />
                    <component :is="node.kind === 'group' ? Folder : FileText" :size="16" />
                    <span class="yy-receive-name">{{ node.title }}</span>
                    <button v-if="node.kind === 'group' || node.children?.length" type="button" class="yy-receive-open" :aria-label="`打开 ${node.title}`" :disabled="saving" @click.stop="browse(node, index)"><ChevronRight :size="14" /></button>
                  </div>
                </li>
              </ul>
              <p v-if="!column.nodes.length" class="yy-receive-empty">这里还没有文档</p>
            </template>
          </section>
        </div>
        <p class="yy-receive-help">单击选择，⌘ / Ctrl 多选，Shift 连选；勾选可保留不同目录中的选择。选择分组会包含其全部子项。</p>
        <p v-if="failure || selectedNodes.length > 5000" class="yy-receive-error" role="alert">{{ selectedNodes.length > 5000 ? '一次最多移动 5000 项，请减少选择。' : failure }}</p>
        <div class="yy-receive-footer">
          <div class="yy-receive-selection"><span aria-live="polite">已选 {{ docsCount }} 篇文档<span v-if="groupsCount">、{{ groupsCount }} 个分组</span></span><button type="button" class="yy-link-btn" :disabled="saving || loading || !book" @click="selectColumn">全选当前列</button><button type="button" class="yy-link-btn" :disabled="saving || !selectedNodes.length" @click="selection.exit(); anchor = null">清空</button></div>
          <div class="yy-dialog-actions"><button type="button" class="yy-btn" :disabled="saving" @click="close">取消</button><button type="button" class="yy-btn primary" :disabled="!canMove" @click="move">{{ saving ? '正在移入…' : '移入' }}</button></div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.yy-receive-dialog { top: 8vh; width: min(960px, calc(100vw - 32px)); padding: 22px; max-height: 84dvh; overflow-y: auto; }
.yy-receive-destination { margin: -4px 0 14px; font-size: 13px; color: var(--yy-text-2); }
.yy-receive-path { display: flex; align-items: center; gap: 4px; min-height: 30px; overflow-x: auto; white-space: nowrap; font-size: 12px; color: var(--yy-text-3); }
.yy-receive-path button { padding: 4px; border: 0; background: none; color: var(--yy-text-2); cursor: pointer; }
.yy-receive-path button:hover { color: var(--yy-primary); }
.yy-receive-path svg { flex-shrink: 0; }
.yy-receive-browser { display: flex; position: relative; height: min(350px, 45dvh); min-height: 170px; border: 1px solid var(--yy-border); border-radius: var(--yy-radius); overflow-x: auto; overscroll-behavior: contain; }
.yy-receive-column { flex: 1 0 215px; min-width: 0; overflow-y: auto; border-right: 1px solid var(--yy-border); }
.yy-receive-column:last-child { border-right: 0; }
.yy-receive-column h3 { position: sticky; top: 0; z-index: 1; margin: 0; padding: 10px 12px; font-size: 12px; font-weight: 500; color: var(--yy-text-3); background: var(--yy-bg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yy-receive-column ul { list-style: none; margin: 0; padding: 0 5px 8px; }
.yy-receive-choice, .yy-receive-row { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 34px; padding: 6px 8px; border: 0; border-radius: 5px; background: none; color: var(--yy-text); font-size: 13px; text-align: left; cursor: pointer; user-select: none; }
.yy-receive-choice:hover, .yy-receive-row:hover { background: var(--yy-bg-hover); }
.yy-receive-choice.selected, .yy-receive-row.selected { color: var(--yy-primary); background: var(--yy-primary-soft); }
.yy-receive-row.browsing:not(.selected) { background: var(--yy-bg-hover); }
.yy-receive-choice svg, .yy-receive-row > svg, .yy-receive-row input { flex-shrink: 0; }
.yy-receive-choice span, .yy-receive-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yy-receive-open { display: flex; align-items: center; justify-content: center; align-self: stretch; min-width: 24px; margin: -6px -8px -6px 0; border: 0; border-radius: 0 5px 5px 0; background: none; color: inherit; cursor: pointer; }
.yy-receive-open:hover { background: color-mix(in srgb, var(--yy-primary) 12%, transparent); }
.yy-receive-empty { margin: 16px 12px; color: var(--yy-text-3); font-size: 13px; }
.yy-receive-empty button { display: block; margin-top: 8px; }
.yy-receive-help, .yy-receive-error { margin: 12px 0; color: var(--yy-text-3); font-size: 12px; line-height: 1.6; }
.yy-receive-error { color: var(--yy-danger); }
.yy-receive-footer, .yy-receive-selection { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.yy-receive-footer { justify-content: space-between; }
.yy-receive-selection { color: var(--yy-text-2); font-size: 12px; }
.yy-receive-footer .yy-dialog-actions { margin-top: 0; }
@media (max-width: 640px) {
  .yy-receive-dialog { top: 16px; padding: 16px; max-height: calc(100dvh - 32px); }
  .yy-receive-browser { scroll-snap-type: x mandatory; height: min(320px, 43dvh); }
  .yy-receive-column { flex: 0 0 100%; scroll-snap-align: start; }
  .yy-receive-footer { align-items: stretch; gap: 16px; }
  .yy-receive-selection { width: 100%; gap: 10px; }
  .yy-receive-footer .yy-dialog-actions { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) { .yy-receive-dialog { animation: none; } }
</style>
