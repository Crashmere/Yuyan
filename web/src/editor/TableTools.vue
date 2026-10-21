<script setup lang="ts">
import { computed, onBeforeUnmount, useId, watch } from 'vue'
import { findParentNode, type ChainedCommands } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { CellSelection } from '@tiptap/pm/tables'
import { Merge, ArrowLeftRight } from 'lucide-vue-next'
import ColorPicker from './ColorPicker.vue'
import { openColorPicker } from './colorPreferences'
import TableHeaderIcon from './TableHeaderIcon.vue'
import TableSettingsMenu from './TableSettingsMenu.vue'
import TableSplitMenu from './TableSplitMenu.vue'
import CellAlignmentControls from './CellAlignmentControls.vue'
import { useEditorContext } from './context'
import { fitTableColumns, tablesInSelection } from './tableFit'
import { isFirstRowHeader, openTableMenu, setTableHeaderRows, tableHeaderRowCount } from './tableHeaders'
import { canSplitSelectedCells, splitSelectedCells } from './splitTableCells'

defineProps<{ compact?: boolean; standalone?: boolean }>()
const { editor, tick } = useEditorContext()
const id = useId()
const tableCount = computed(() => { void tick.value; return editor.value ? tablesInSelection(editor.value.state).length : 0 })
const fitLabel = computed(() => tableCount.value > 1 ? `按内容适配列宽（${tableCount.value} 个表格）` : '按内容适配列宽')
const splitOpen = computed({
  get: () => openTableMenu.value === `${id}:split`,
  set: (v) => {
    if (v) { openTableMenu.value = `${id}:split`; openColorPicker.value = null }
    else if (openTableMenu.value === `${id}:split`) openTableMenu.value = null
  },
})
const settingsOpen = computed({
  get: () => openTableMenu.value === `${id}:settings`,
  set: (v) => {
    if (v) { openTableMenu.value = `${id}:settings`; openColorPicker.value = null }
    else if (openTableMenu.value === `${id}:settings`) openTableMenu.value = null
  },
})
let rememberedSelection: { anchor: number; head: number } | null = null

watch(openColorPicker, (v) => { if (v) openTableMenu.value = null })
onBeforeUnmount(() => {
  if (openTableMenu.value?.startsWith(`${id}:`)) openTableMenu.value = null
})

function rememberTableSelection() {
  const selection = editor.value?.state.selection
  rememberedSelection = selection instanceof CellSelection
    ? { anchor: selection.$anchorCell.pos, head: selection.$headCell.pos }
    : null
}

function apply(command: (chain: ChainedCommands) => ChainedCommands, restoreSelection = false) {
  openTableMenu.value = null
  const e = editor.value
  if (!e) return
  let chain = e.chain()
  const remembered = restoreSelection ? rememberedSelection : null
  if (restoreSelection) rememberedSelection = null
  if (remembered) {
    chain = chain.command(({ tr }) => {
      tr.setSelection(CellSelection.create(tr.doc, remembered.anchor, remembered.head))
      return true
    })
  }
  command(chain.focus().command(({ tr }) => { closeHistory(tr); return true })).run()
  e.view.dispatch(closeHistory(e.state.tr))
  const result = restoreSelection && e.state.selection instanceof CellSelection
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
  if (!table) return null
  const selected: (string | null)[] = []
  if (e.state.selection instanceof CellSelection) e.state.selection.forEachCell(n => selected.push(n.attrs.backgroundColor))
  else selected.push(e.getAttributes(e.isActive('tableHeader') ? 'tableHeader' : 'tableCell').backgroundColor ?? null)
  const backgroundMixed = !selected.every(c => c === selected[0])
  return {
    merge: e.can().mergeCells(),
    split: e.can().splitCell(),
    directionalSplit: canSplitSelectedCells(e.state),
    header: isFirstRowHeader(table),
    headerRows: tableHeaderRowCount(table),
    rowCount: table.childCount,
    canToggleHeader: table.childCount > 0,
    background: backgroundMixed ? null : selected[0],
    backgroundMixed,
  }
})
</script>

<template>
  <template v-if="editor && (tableCount || splitOpen || settingsOpen)">
    <span v-if="!standalone" :class="compact ? 'yy-bubble-sep' : 'yy-toolbar-sep'"></span>
    <button v-if="tableCount" type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" :aria-label="fitLabel" :data-tip="fitLabel" @mousedown.prevent @click="openTableMenu = null; fitTableColumns(editor)"><ArrowLeftRight :size="17" /></button>
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
      @remember="rememberTableSelection"
      @horizontal="apply(chain => chain.command(({ tr }) => splitSelectedCells(tr, 'horizontal')), true)"
      @vertical="apply(chain => chain.command(({ tr }) => splitSelectedCells(tr, 'vertical')), true)"
      @unmerge="apply(chain => chain.splitCell(), true)"
    />
    <CellAlignmentControls v-if="compact && state" :compact="compact" />
    <template v-if="state">
      <ColorPicker kind="cell" :compact="compact" :value="state.background" :mixed="state.backgroundMixed" @pick="color => apply(chain => chain.setCellAttribute('backgroundColor', color))" />
      <button type="button" :class="[compact ? 'yy-bubble-btn' : 'yy-icon-btn', { active: state.header }]" aria-label="首行为表头" :aria-pressed="state.header" :data-tip="state.header ? '取消首行为表头' : '首行为表头'" :disabled="!state.canToggleHeader" @mousedown.prevent @click="rememberTableSelection(); apply(chain => chain.command(({ tr }) => setTableHeaderRows(tr, state?.header ? 0 : 1)), true)"><TableHeaderIcon /></button>
    </template>
    <TableSettingsMenu
      v-if="state || settingsOpen"
      v-model:open="settingsOpen"
      :compact="compact"
      :disabled="!state?.canToggleHeader"
      :row-count="state?.rowCount ?? 0"
      :header-rows="state?.headerRows ?? null"
      @remember="rememberTableSelection"
      @select="count => apply(chain => chain.command(({ tr }) => setTableHeaderRows(tr, count)), true)"
    />
  </template>
</template>
