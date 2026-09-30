<script setup lang="ts">
import { computed } from 'vue'
import { findParentNode, type ChainedCommands } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { CellSelection } from '@tiptap/pm/tables'
import { Columns2, Merge, TableProperties } from 'lucide-vue-next'
import ActionMenu from '../ui/ActionMenu.vue'
import ColorPicker from './ColorPicker.vue'
import { useEditorContext } from './context'

defineProps<{ compact?: boolean }>()
const { editor, tick } = useEditorContext()
function apply(command: (chain: ChainedCommands) => ChainedCommands) {
  const e = editor.value
  if (!e) return
  command(e.chain().focus().command(({ tr }) => { closeHistory(tr); return true })).run()
  e.view.dispatch(closeHistory(e.state.tr))
}
const state = computed(() => {
  void tick.value
  const e = editor.value
  if (!e || !e.isActive('table')) return null
  const table = findParentNode(n => n.type.name === 'table')(e.state.selection)?.node
  const selected: (string | null)[] = []
  if (e.state.selection instanceof CellSelection) e.state.selection.forEachCell(n => selected.push(n.attrs.backgroundColor))
  else selected.push(e.getAttributes(e.isActive('tableHeader') ? 'tableHeader' : 'tableCell').backgroundColor ?? null)
  const headers: boolean[] = []
  table?.firstChild?.forEach(n => headers.push(n.type.name === 'tableHeader'))
  const backgroundMixed = !selected.every(c => c === selected[0])
  return { merge: e.can().mergeCells(), split: e.can().splitCell(), header: headers.length > 0 && headers.every(Boolean), background: backgroundMixed ? null : selected[0], backgroundMixed }
})
const items = computed(() => {
  const e = editor.value
  return [{ label: '首行为表头', checked: !!state.value?.header, disabled: !e?.can().toggleHeaderRow(), run: () => apply(chain => chain.toggleHeaderRow()) }]
})
</script>

<template>
  <template v-if="editor && state">
    <span :class="compact ? 'yy-bubble-sep' : 'yy-toolbar-sep'"></span>
    <button type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" aria-label="合并单元格" data-tip="合并单元格" :disabled="!state.merge" @mousedown.prevent @click="apply(chain => chain.mergeCells())"><Merge :size="17" /></button>
    <button type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" aria-label="拆分单元格" data-tip="拆分单元格" :disabled="!state.split" @mousedown.prevent @click="apply(chain => chain.splitCell())"><Columns2 :size="17" /></button>
    <ColorPicker kind="cell" :compact="compact" :value="state.background" :mixed="state.backgroundMixed" @pick="color => apply(chain => chain.setCellAttribute('backgroundColor', color))" />
    <ActionMenu :items="items" :restore-focus="false">
      <button type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" aria-label="表格设置" data-tip="表格设置" @mousedown.prevent><TableProperties :size="17" /></button>
    </ActionMenu>
  </template>
</template>
