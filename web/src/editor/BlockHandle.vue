<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ArrowDown, ArrowUp, CopyPlus, GripVertical, Plus, Replace, Trash2 } from 'lucide-vue-next'
import ActionMenu from '../ui/ActionMenu.vue'
import type { MenuEntry } from '../ui/menu'
import { blockTargets, canMove, deleteBlock, duplicateBlock, moveBlock, turnInto } from './commands'
import { useEditorContext } from './context'

// Beside the block under the pointer: "+" inserts below it through the slash menu, and the grip
// drags the block or, when clicked, opens the block menu.
const { editor } = useEditorContext()
const current = shallowRef<{ node: PMNode; pos: number } | null>(null)
const menuOpen = ref(false)

function onNodeChange({ node, pos }: { node: PMNode | null; pos: number }) {
  if (!menuOpen.value) current.value = node ? { node, pos } : null
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

function insertBelow() {
  const e = editor.value
  const c = current.value
  if (!e || !c) return
  if (c.node.type.name === 'paragraph' && c.node.content.size === 0) {
    e.chain().focus().setTextSelection(c.pos + 1).insertContent('/').run()
  } else {
    const at = c.pos + c.node.nodeSize
    e.chain().focus().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).insertContent('/').run()
  }
}
</script>

<template>
  <DragHandle v-if="editor" :editor="editor" :on-node-change="onNodeChange" class="yy-block-handle">
    <button type="button" class="yy-handle-btn" title="在下方插入" @mousedown.prevent @click="insertBelow"><Plus :size="16" /></button>
    <ActionMenu v-model:open="menuOpen" :items="menu" align="start" :restore-focus="false">
      <button type="button" class="yy-handle-btn grip" title="拖动调整位置，点击打开菜单"><GripVertical :size="16" /></button>
    </ActionMenu>
  </DragHandle>
</template>
