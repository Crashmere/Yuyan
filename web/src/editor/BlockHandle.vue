<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'
import type { NestedOptions } from '@tiptap/extension-drag-handle'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ArrowDown, ArrowUp, CopyPlus, GripVertical, Replace, Trash2 } from 'lucide-vue-next'
import ActionMenu from '../ui/ActionMenu.vue'
import type { MenuEntry } from '../ui/menu'
import { blockTargets, canMove, deleteBlock, duplicateBlock, moveBlock, turnInto } from './commands'
import { useEditorContext } from './context'
import { keepBlockHandleReachable } from './blockHandleHover'

// Only headings expose a level-labelled grip; clicking it keeps the existing heading menu.
const { editor } = useEditorContext()
const current = shallowRef<{ node: PMNode; pos: number } | null>(null)
const menuOpen = ref(false)
const gripButton = ref<HTMLElement | null>(null)
watch(editor, (e, _old, onCleanup) => {
  if (e) onCleanup(keepBlockHandleReachable(e, () => current.value, () => gripButton.value?.closest<HTMLElement>('.yy-block-handle') ?? null, () => menuOpen.value))
}, { immediate: true })
// Keep heading grips in container bodies, without exposing their structural wrappers.
const nested: NestedOptions = {
  defaultRules: false,
  edgeDetection: 'none',
  rules: [{
    id: 'headings',
    evaluate: ({ node, parent }) => node.type.name === 'heading' && ['doc', 'highlightBlock', 'foldContent', 'column'].includes(parent?.type.name ?? '') ? 0 : 1000,
  }],
}
// As in Feishu, the grip of a heading shows its level.
const level = computed(() => (current.value?.node.type.name === 'heading' ? (current.value.node.attrs.level as number) : 0))

function onNodeChange({ node, pos }: { node: PMNode | null; pos: number }) {
  if (!menuOpen.value) current.value = node?.type.name === 'heading' ? { node, pos } : null
}

// Keep the handle in place while its menu is open.
watch(menuOpen, (open) => {
  const e = editor.value
  if (e && !e.isDestroyed) e.view.dispatch(e.state.tr.setMeta('lockDragHandle', open))
})

const menu = computed<MenuEntry[]>(() => {
  const e = editor.value
  const c = current.value
  if (!e || !c) return []
  // After an action the remembered position may belong to another block, so the handle is hidden
  // until the pointer picks a block again.
  const act = (action: () => void) => () => {
    action()
    current.value = null
    e.view.dispatch(e.state.tr.setMeta('hideDragHandle', true))
  }
  return [
    { label: '转换为', icon: Replace, children: blockTargets.map((t) => ({ label: t.label, icon: t.icon, run: act(() => turnInto(e, c.pos, t.id)) })) },
    null,
    { label: '复制', icon: CopyPlus, run: act(() => duplicateBlock(e, c.pos)) },
    { label: '上移', icon: ArrowUp, disabled: !canMove(e, c.pos, -1), run: act(() => moveBlock(e, c.pos, -1)) },
    { label: '下移', icon: ArrowDown, disabled: !canMove(e, c.pos, 1), run: act(() => moveBlock(e, c.pos, 1)) },
    null,
    { label: '删除', icon: Trash2, danger: true, run: act(() => deleteBlock(e, c.pos)) },
  ]
})
</script>

<template>
  <DragHandle v-if="editor" :editor="editor" :nested="nested" :on-node-change="onNodeChange" :class="level ? 'yy-block-handle has-heading' : 'yy-block-handle'">
    <ActionMenu v-model:open="menuOpen" :items="menu" align="start" :restore-focus="false">
      <button ref="gripButton" type="button" class="yy-handle-btn grip is-heading" data-tip="拖动调整位置，点击打开菜单" :aria-label="`H${level || 1} 标题：拖动调整位置，点击打开菜单`">
        <span class="yy-handle-level">H<sub>{{ level || 1 }}</sub></span><GripVertical :size="14" />
      </button>
    </ActionMenu>
  </DragHandle>
</template>
