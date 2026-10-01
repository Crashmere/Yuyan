<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Node as PMNode } from '@tiptap/pm/model'
import { prefs } from '../app/prefs'
import { topbarHeight, useOutlineTracking } from '../app/content/outline'
import OutlinePanel, { type OutlineEntry } from '../app/content/OutlinePanel.vue'
import { useEditorContext } from './context'
import { headingSections } from './sections'
import { moveSection, sectionMove } from './moveSection'
import { outlineDrag } from './outlineDrag'

const emit = defineEmits<{ navigate: [] }>()

// Reuse the section index already cached by the editor. Update positions immediately after an
// edit/undo, so dragging never starts from an outline still showing the previous document.
const { editor } = useEditorContext()
const entries = ref<(OutlineEntry & { pos: number })[]>([])
const panel = ref<InstanceType<typeof OutlinePanel>>()
let collectedDoc: PMNode | undefined
let stopDrag: (() => void) | undefined

const { active, refresh, jumped } = useOutlineTracking(
  () => entries.value.map((h) => (editor.value?.view.nodeDOM(h.pos) as Element | null) ?? null),
  () => topbarHeight() + 44 + 24,
)

// Keys stay the same while text elsewhere changes, so folded entries stay folded.
function collect() {
  const e = editor.value
  if (!e) return
  collectedDoc = e.state.doc
  entries.value = headingSections(e.state.doc).map(section => ({ key: section.id, level: section.level, text: section.node.textContent.trim() || '（空标题）', pos: section.pos }))
  refresh()
}

function go(i: number) {
  const e = editor.value
  const key = entries.value[i]?.key
  if (e && collectedDoc !== e.state.doc) collect()
  const h = entries.value.find(h => h.key === key)
  if (!e || !h) return
  e.commands.setTextSelection(h.pos + 1)
  const dom = e.view.nodeDOM(h.pos)
  if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
  jumped(i)
  emit('navigate')
}

onMounted(() => {
  stopDrag = outlineDrag(panel.value!.$el, {
    version: () => editor.value?.state.doc,
    canMove(source, target, side) {
      const e = editor.value, from = entries.value.find(h => h.key === source), to = entries.value.find(h => h.key === target)
      return !!(e && e.state.doc === collectedDoc && from && to && sectionMove(e.state, from.pos, to.pos, side))
    },
    move(source, target, side) {
      const e = editor.value, from = entries.value.find(h => h.key === source), to = entries.value.find(h => h.key === target)
      if (!e || e.state.doc !== collectedDoc || !from || !to) return
      if (moveSection(e, from.pos, to.pos, side)) { collect(); refresh() }
    },
  })
})

watch(
  editor,
  (e, old) => {
    old?.off('update', collect)
    old?.off('transaction', refresh)
    e?.on('update', collect)
    e?.on('transaction', refresh)
    collect()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  editor.value?.off('update', collect)
  editor.value?.off('transaction', refresh)
  stopDrag?.()
})
</script>

<template>
  <OutlinePanel
    ref="panel"
    :items="entries"
    :active="active"
    :pinned="prefs.editorOutline"
    empty-text="添加标题后，这里会显示大纲"
    reorderable
    @pin="(v) => (prefs.editorOutline = v)"
    @go="go"
  />
</template>
