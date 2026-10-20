<script setup lang="ts">
import { computed, ref } from 'vue'
import { findParentNode, type ChainedCommands } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { CellSelection } from '@tiptap/pm/tables'
import { Merge, TableProperties, ArrowLeftRight } from 'lucide-vue-next'
import ColorPicker from './ColorPicker.vue'
import TableHeaderIcon from './TableHeaderIcon.vue'
import TableSplitMenu from './TableSplitMenu.vue'
import { useEditorContext } from './context'
import { fitTableColumns, tablesInSelection } from './tableFit'
import { canSplitSelectedCells, splitSelectedCells } from './splitTableCells'

defineProps<{ compact?: boolean }>()
const { editor, tick } = useEditorContext()
const tableCount = computed(() => { void tick.value; return editor.value ? tablesInSelection(editor.value.state).length : 0 })
const fitLabel = computed(() => tableCount.value > 1 ? `按内容适配列宽（${tableCount.value} 个表格）` : '按内容适配列宽')
const splitOpen = ref(false)
let splitSelection: { anchor: number; head: number } | null = null

function rememberSplitSelection() {
  const selection = editor.value?.state.selection
  splitSelection = selection instanceof CellSelection
    ? { anchor: selection.$anchorCell.pos, head: selection.$headCell.pos }
    : null
}

function apply(command: (chain: ChainedCommands) => ChainedCommands, restoreSplit = false) {
  const e = editor.value
  if (!e) return
  let chain = e.chain()
  const remembered = restoreSplit ? splitSelection : null
  if (restoreSplit) splitSelection = null
  if (remembered) {
    chain = chain.command(({ tr }) => {
      tr.setSelection(CellSelection.create(tr.doc, remembered.anchor, remembered.head))
      return true
    })
  }
  command(chain.focus().command(({ tr }) => { closeHistory(tr); return true })).run()
  e.view.dispatch(closeHistory(e.state.tr))
  const result = restoreSplit && e.state.selection instanceof CellSelection
    ? { anchor: e.state.selection.$anchorCell.pos, head: e.state.selection.$headCell.pos }
    : null
  const resultDoc = e.state.doc
  if (result) requestAnimationFrame(() => {
    if (e.isDestroyed || e.state.doc !== resultDoc) return
    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, result.anchor, result.head)))
    e.view.focus()
  })
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
  return {
    merge: e.can().mergeCells(),
    split: e.can().splitCell(),
    directionalSplit: canSplitSelectedCells(e.state),
    header: headers.length > 0 && headers.every(Boolean),
    canToggleHeader: e.can().toggleHeaderRow(),
    background: backgroundMixed ? null : selected[0],
    backgroundMixed,
  }
})
</script>

<template>
  <template v-if="editor && (tableCount || splitOpen)">
    <span :class="compact ? 'yy-bubble-sep' : 'yy-toolbar-sep'"></span>
    <button v-if="tableCount" type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" :aria-label="fitLabel" :data-tip="fitLabel" @mousedown.prevent @click="fitTableColumns(editor)"><ArrowLeftRight :size="17" /></button>
    <template v-if="state">
      <button type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" aria-label="合并单元格" data-tip="合并单元格" :disabled="!state.merge" @mousedown.prevent @click="apply(chain => chain.mergeCells())"><Merge :size="17" /></button>
    </template>
    <TableSplitMenu
      v-if="state || splitOpen"
      v-model:open="splitOpen"
      :compact="compact"
      :disabled="!state?.directionalSplit && !state?.split"
      :directional="!!state?.directionalSplit"
      :merged="!!state?.split"
      @remember="rememberSplitSelection"
      @horizontal="apply(chain => chain.command(({ tr }) => splitSelectedCells(tr, 'horizontal')), true)"
      @vertical="apply(chain => chain.command(({ tr }) => splitSelectedCells(tr, 'vertical')), true)"
      @unmerge="apply(chain => chain.splitCell(), true)"
    />
    <template v-if="state">
      <ColorPicker kind="cell" :compact="compact" :value="state.background" :mixed="state.backgroundMixed" @pick="color => apply(chain => chain.setCellAttribute('backgroundColor', color))" />
      <button type="button" :class="[compact ? 'yy-bubble-btn' : 'yy-icon-btn', { active: state.header }]" aria-label="首行为表头" :aria-pressed="state.header" :data-tip="state.header ? '取消首行为表头' : '首行为表头'" :disabled="!state.canToggleHeader" @mousedown.prevent @click="apply(chain => chain.toggleHeaderRow())"><TableHeaderIcon /></button>
      <button type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" aria-label="表格设置" data-tip="表格设置" disabled><TableProperties :size="17" /></button>
    </template>
  </template>
</template>
