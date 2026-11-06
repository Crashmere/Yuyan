<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import { errorMessage, type TreeNode } from '../../shared/api'
import { scrollToPosition } from '../../shared/scroll'
import { toast } from '../../ui/toast'
import { nodeMenu } from '../actions'
import { loadExpanded, saveExpanded } from '../prefs'
import * as store from '../store'
import TreeItem from './TreeItem.vue'
import { dropsIntoNode, treeKey, type DropPosition } from './context'
import { useTreeSelection } from './selection'
import { dragScroll } from './dragScroll'

const props = defineProps<{ bookId: number; nodes: TreeNode[]; currentId: number | null; busy?: boolean }>()
const root = ref<HTMLElement | null>(null)

const expanded = reactive(loadExpanded(props.bookId))
const selection = useTreeSelection(() => props.nodes, (id) => expanded.has(id))
const { active: selecting, selectedNodes, roots: selectedRoots, allState: selectionState } = selection
const renaming = ref<number | null>(null)
const moving = ref(false)
const busy = computed(() => !!props.busy || moving.value)
const drag = reactive({ id: null as number | null, ids: [] as number[], overId: null as number | null, position: null as DropPosition | null })
let draggedRoots: TreeNode[] = []
let batchDrag = false
const dropAtEnd = ref(false)
let expandTimer: ReturnType<typeof setTimeout> | undefined
let stopDragScroll: (() => void) | undefined

function toggle(id: number, open = !expanded.has(id)) {
  if (open) expanded.add(id)
  else expanded.delete(id)
  saveExpanded(props.bookId, expanded)
}

// If every root branch is closed, nested expansion state is invisible and we offer to open all.
const hasBranches = computed(() => props.nodes.some((n) => n.children?.length))
const hasExpanded = computed(() => props.nodes.some((n) => n.children?.length && expanded.has(n.id)))

function foldAll() {
  expanded.clear()
  saveExpanded(props.bookId, expanded)
}
function unfoldAll() {
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (!n.children?.length) continue
      expanded.add(n.id)
      walk(n.children)
    }
  }
  walk(props.nodes)
  saveExpanded(props.bookId, expanded)
}
function toggleAll() {
  if (hasExpanded.value) foldAll()
  else unfoldAll()
}
const canLocate = computed(() => props.currentId !== null && !!store.locate(props.bookId, props.currentId))

async function locateCurrent(center = true) {
  const id = props.currentId
  const found = store.locate(props.bookId, id)
  if (!found) return
  for (const p of found.path) if (!expanded.has(p.id)) toggle(p.id, true)
  await nextTick()
  const row = root.value?.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)
  const scroll = root.value?.closest('.yy-tree-scroll')
  if (!row || !(scroll instanceof HTMLElement)) return
  const box = row.getBoundingClientRect(), frame = scroll.getBoundingClientRect()
  if (center) scrollToPosition(scroll, { top: scroll.scrollTop + box.top - frame.top - (scroll.clientHeight - box.height) / 2 })
  else row.scrollIntoView({ block: 'nearest' })
}
function startSelecting() { renaming.value = null; reset(); selecting.value = true }
defineExpose({ hasBranches, hasExpanded, toggleAll, canLocate, locateCurrent, selecting, selectedNodes, selectedRoots,
  selectionState, moving, startSelecting, exitSelecting: selection.exit, selectAll: selection.selectAll, clearSelection: () => selection.selected.clear() })
watch(selecting, reset)

// Opening a document expands the path to it and scrolls its row into view.
watch(
  () => [props.currentId, props.nodes] as const,
  () => locateCurrent(false),
  { immediate: true },
)

async function finishRename(node: TreeNode, title: string | null) {
  if (renaming.value !== node.id) return
  renaming.value = null
  const t = title?.trim()
  if (!t || t === node.title) return
  try {
    await store.renameDoc(props.bookId, node.id, t)
  } catch (e) {
    toast(`重命名失败：${errorMessage(e)}`, 'error')
  }
}

function canDrop(node: TreeNode): boolean {
  return drag.id != null && !busy.value && !draggedRoots.some((n) => store.contains(n, node.id))
}

function positionOf(row: Element, clientY: number): DropPosition {
  const rect = row.getBoundingClientRect()
  const y = (clientY - rect.top) / rect.height
  return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
}

function clearDrop() {
  clearTimeout(expandTimer)
  drag.overId = null
  drag.position = null
  dropAtEnd.value = false
}

function reset() {
  stopDragScroll?.()
  stopDragScroll = undefined
  clearDrop()
  drag.id = null
  drag.ids = []
  draggedRoots = []
  batchDrag = false
}
onBeforeUnmount(reset)

function leaveTree(e: DragEvent) {
  if (!(e.relatedTarget instanceof Node) || !(e.currentTarget as HTMLElement).contains(e.relatedTarget)) clearDrop()
}

function overNode(node: TreeNode, position: DropPosition) {
  if (!canDrop(node)) { clearDrop(); return }
  if (drag.overId === node.id && drag.position === position) return
  clearDrop()
  drag.overId = node.id
  drag.position = position
  if (position === 'inside' && node.children?.length && !expanded.has(node.id)) expandTimer = setTimeout(() => toggle(node.id, true), 700)
}

function locateDrop(x: number, y: number) {
  const el = document.elementFromPoint(x, y)
  const row = el?.closest<HTMLElement>('[data-tree-id]')
  if (row && root.value?.contains(row)) {
    const node = store.locate(props.bookId, Number(row.dataset.treeId))?.node
    if (node) { overNode(node, positionOf(row, y)); return }
  }
  clearDrop()
  if (el?.closest('.yy-tree-end') === root.value?.nextElementSibling) dropAtEnd.value = true
}

// The destination index counts siblings after removing every moving root.
function target(node: TreeNode, position: DropPosition, roots: TreeNode[]): { parentId: number | null; index: number } {
  const ids = new Set(roots.map((n) => n.id))
  // Below an expanded node with children the drop line sits above its first child.
  if (dropsIntoNode(node, position, expanded.has(node.id))) {
    const kids = (node.children ?? []).filter((c) => !ids.has(c.id))
    return { parentId: node.id, index: position === 'inside' ? kids.length : 0 }
  }
  const found = store.locate(props.bookId, node.id)!
  const siblings = found.siblings.filter((s) => !ids.has(s.id))
  const i = siblings.findIndex((s) => s.id === node.id)
  return { parentId: found.parent?.id ?? null, index: position === 'before' ? i : i + 1 }
}

async function move(roots: TreeNode[], ids: number[], batch: boolean, to: { parentId: number | null; index: number }) {
  const siblings = to.parentId == null ? props.nodes : store.locate(props.bookId, to.parentId)?.node.children ?? []
  const rootIds = roots.map((n) => n.id)
  const order = siblings.filter((n) => !rootIds.includes(n.id)).map((n) => n.id)
  order.splice(to.index, 0, ...rootIds)
  if (roots.every((n) => n.parentId === to.parentId) && order.length === siblings.length && order.every((id, i) => id === siblings[i].id)) return
  moving.value = true
  try {
    if (batch) {
      const result = await store.batchDocs(props.bookId, ids, 'move', { bookId: props.bookId, ...to })
      selection.selected.clear()
      toast(`已移动 ${ids.length} 项${result.refreshed ? '' : '，请刷新页面以更新目录'}`, 'success')
    } else await store.moveDoc(roots[0].id, props.bookId, { bookId: props.bookId, ...to })
    if (to.parentId != null) toggle(to.parentId, true)
  } catch (err) {
    toast(`移动失败：${errorMessage(err)}`, 'error')
  } finally { moving.value = false }
}

function overEnd(e: DragEvent) {
  if (drag.id == null || busy.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  clearDrop()
  dropAtEnd.value = true
}

async function dropEnd(e: DragEvent) {
  const roots = draggedRoots, ids = [...drag.ids], batch = batchDrag
  const atEnd = dropAtEnd.value
  const index = props.nodes.filter((n) => !roots.some((r) => r.id === n.id)).length
  reset()
  if (!roots.length || !atEnd || busy.value) return
  e.preventDefault()
  await move(roots, ids, batch, { parentId: null, index })
}

provide(treeKey, {
  bookId: props.bookId,
  currentId: () => props.currentId,
  isOpen: (id) => expanded.has(id),
  toggle,
  selecting: () => selecting.value,
  selectionState: selection.state,
  select: (node, range) => { if (!busy.value) selection.toggle(node, range) },
  busy: () => busy.value,
  renaming,
  finishRename,
  menu: (node) => nodeMenu(props.bookId, node, { rename: () => (renaming.value = node.id) }),
  drag,
  onDragStart(node, e) {
    if (busy.value || (selecting.value && selection.state(node) !== true)) { e.preventDefault(); return }
    reset()
    drag.id = node.id
    batchDrag = selecting.value
    drag.ids = (batchDrag ? selectedNodes.value : [node]).map((n) => n.id)
    draggedRoots = batchDrag ? [...selectedRoots.value] : [node]
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', draggedRoots.map((n) => n.title).join('\n'))
    }
    const scroller = root.value?.closest<HTMLElement>('.yy-tree-scroll')
    if (scroller) stopDragScroll = dragScroll(scroller, locateDrop)
  },
  onDragOver(node, e) {
    if (!canDrop(node)) { clearDrop(); return }
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    overNode(node, positionOf(e.currentTarget as Element, e.clientY))
  },
  async onDrop(node, e) {
    e.preventDefault()
    const roots = draggedRoots, ids = [...drag.ids], batch = batchDrag
    const position = positionOf(e.currentTarget as Element, e.clientY)
    const to = canDrop(node) ? target(node, position, roots) : null
    reset()
    if (!to) return
    await move(roots, ids, batch, to)
  },
  onDragEnd: reset,
})
</script>

<template>
  <ul v-if="nodes.length" ref="root" class="yy-tree" role="tree" :aria-multiselectable="selecting || undefined" @dragleave="leaveTree">
    <TreeItem v-for="n in nodes" :key="n.id" :node="n" :depth="0" />
  </ul>
  <p v-else class="yy-tree-empty">还没有文档</p>
  <div v-if="nodes.length" class="yy-tree-end" :class="{ 'drop-end': dropAtEnd }" aria-hidden="true"
    @dragenter="overEnd" @dragover="overEnd" @drop="dropEnd" @dragleave="clearDrop">
    <span v-if="drag.id !== null">放到最顶层末尾</span>
  </div>
</template>
