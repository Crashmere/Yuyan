<script setup lang="ts">
import { computed, nextTick, provide, reactive, ref, watch } from 'vue'
import { errorMessage, type TreeNode } from '../../shared/api'
import { toast } from '../../ui/toast'
import { nodeMenu } from '../actions'
import { loadExpanded, saveExpanded } from '../prefs'
import * as store from '../store'
import TreeItem from './TreeItem.vue'
import { dropsIntoNode, treeKey, type DropPosition } from './context'
import { useTreeSelection } from './selection'

const props = defineProps<{ bookId: number; nodes: TreeNode[]; currentId: number | null; busy?: boolean }>()
const root = ref<HTMLElement | null>(null)

const expanded = reactive(loadExpanded(props.bookId))
const selection = useTreeSelection(() => props.nodes, (id) => expanded.has(id))
const { active: selecting, selectedNodes, roots: selectedRoots, allState: selectionState } = selection
const renaming = ref<number | null>(null)
const drag = reactive({ id: null as number | null, overId: null as number | null, position: null as DropPosition | null })
const dropAtEnd = ref(false)
let expandTimer: ReturnType<typeof setTimeout> | undefined

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
  if (center) scroll.scrollTo({ top: scroll.scrollTop + box.top - frame.top - (scroll.clientHeight - box.height) / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  else row.scrollIntoView({ block: 'nearest' })
}
function startSelecting() { renaming.value = null; reset(); selecting.value = true }
defineExpose({ hasBranches, hasExpanded, toggleAll, canLocate, locateCurrent, selecting, selectedNodes, selectedRoots,
  selectionState, startSelecting, exitSelecting: selection.exit, selectAll: selection.selectAll, clearSelection: () => selection.selected.clear() })

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

function dragged(): TreeNode | null {
  return drag.id == null ? null : (store.locate(props.bookId, drag.id)?.node ?? null)
}

function positionOf(e: DragEvent): DropPosition {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = (e.clientY - rect.top) / rect.height
  return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
}

function clearDrop() {
  clearTimeout(expandTimer)
  drag.overId = null
  drag.position = null
  dropAtEnd.value = false
}

function reset() {
  clearDrop()
  drag.id = null
}

function leaveTree(e: DragEvent) {
  if (!(e.relatedTarget instanceof Node) || !(e.currentTarget as HTMLElement).contains(e.relatedTarget)) clearDrop()
}

// target works out where a drop puts the dragged node; the index counts siblings without it.
function target(node: TreeNode, position: DropPosition, dragId: number): { parentId: number | null; index: number } {
  // Below an expanded node with children the drop line sits above its first child.
  if (dropsIntoNode(node, position, expanded.has(node.id))) {
    const kids = (node.children ?? []).filter((c) => c.id !== dragId)
    return { parentId: node.id, index: position === 'inside' ? kids.length : 0 }
  }
  const found = store.locate(props.bookId, node.id)!
  const siblings = found.siblings.filter((s) => s.id !== dragId)
  const i = siblings.findIndex((s) => s.id === node.id)
  return { parentId: found.parent?.id ?? null, index: position === 'before' ? i : i + 1 }
}

async function move(d: TreeNode, to: { parentId: number | null; index: number }) {
  const from = store.locate(props.bookId, d.id)!
  if ((from.parent?.id ?? null) === to.parentId && from.siblings.indexOf(d) === to.index) return
  try {
    await store.moveDoc(d.id, props.bookId, { bookId: props.bookId, ...to })
    if (to.parentId != null) toggle(to.parentId, true)
  } catch (err) {
    toast(`移动失败：${errorMessage(err)}`, 'error')
  }
}

function overEnd(e: DragEvent) {
  if (!dragged() || selecting.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  clearDrop()
  dropAtEnd.value = true
}

async function dropEnd(e: DragEvent) {
  const d = dragged()
  const atEnd = dropAtEnd.value
  reset()
  if (!d || !atEnd) return
  e.preventDefault()
  await move(d, { parentId: null, index: props.nodes.filter((n) => n.id !== d.id).length })
}

provide(treeKey, {
  bookId: props.bookId,
  currentId: () => props.currentId,
  isOpen: (id) => expanded.has(id),
  toggle,
  selecting: () => selecting.value,
  selectionState: selection.state,
  select: (node, range) => { if (!props.busy) selection.toggle(node, range) },
  busy: () => !!props.busy,
  renaming,
  finishRename,
  menu: (node) => nodeMenu(props.bookId, node, { rename: () => (renaming.value = node.id) }),
  drag,
  onDragStart(node, e) {
    if (selecting.value) { e.preventDefault(); return }
    reset()
    drag.id = node.id
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', node.title)
    }
  },
  onDragOver(node, e) {
    const d = dragged()
    if (!d || store.contains(d, node.id)) { clearDrop(); return }
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const position = positionOf(e)
    if (drag.overId === node.id && drag.position === position) return
    clearDrop()
    drag.overId = node.id
    drag.position = position
    if (position === 'inside' && node.children?.length && !expanded.has(node.id)) expandTimer = setTimeout(() => toggle(node.id, true), 700)
  },
  async onDrop(node, e) {
    e.preventDefault()
    const d = dragged()
    const position = drag.position
    reset()
    if (!d || !position || store.contains(d, node.id)) return
    await move(d, target(node, position, d.id))
  },
  onDragEnd: reset,
})
</script>

<template>
  <ul v-if="nodes.length" ref="root" class="yy-tree" role="tree" :aria-multiselectable="selecting || undefined" @dragleave="leaveTree">
    <TreeItem v-for="n in nodes" :key="n.id" :node="n" :depth="0" />
  </ul>
  <p v-else class="yy-tree-empty">还没有文档</p>
  <div v-if="nodes.length && !selecting" class="yy-tree-end" :class="{ 'drop-end': dropAtEnd }" aria-hidden="true"
    @dragover="overEnd" @drop="dropEnd" @dragleave="clearDrop">
    <span v-if="drag.id !== null">放到最顶层末尾</span>
  </div>
</template>
