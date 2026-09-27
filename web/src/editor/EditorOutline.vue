<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { prefs } from '../app/prefs'
import { topbarHeight, useOutlineTracking } from '../app/content/outline'
import OutlinePanel, { type OutlineEntry } from '../app/content/OutlinePanel.vue'
import { useEditorContext } from './context'

// The outline beside the editor, shown like the reading page's. Headings are collected a moment
// after typing stops, so long documents stay responsive. Jumps put headings below the top bar and
// the toolbar (scroll-margin-top in editor.css).
const { editor } = useEditorContext()
const entries = ref<(OutlineEntry & { pos: number })[]>([])
let timer: ReturnType<typeof setTimeout> | undefined

const { active, refresh, jumped } = useOutlineTracking(
  () => entries.value.map((h) => (editor.value?.view.nodeDOM(h.pos) as Element | null) ?? null),
  () => topbarHeight() + 44 + 24,
)

// Keys stay the same while text elsewhere changes, so folded entries stay folded.
function collect() {
  const e = editor.value
  if (!e) return
  const out: (OutlineEntry & { pos: number })[] = []
  const seen = new Map<string, number>()
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim() || '（空标题）'
      const key = `${node.attrs.level}:${text}`
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      out.push({ key: `${key}:${n}`, level: node.attrs.level as number, text, pos })
      return false
    }
    return !node.isTextblock
  })
  entries.value = out
  refresh()
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(collect, 300)
}

function go(i: number) {
  const e = editor.value
  const h = entries.value[i]
  if (!e || !h) return
  const dom = e.view.nodeDOM(h.pos)
  if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
  e.commands.setTextSelection(h.pos + 1)
  jumped(i)
}

watch(
  editor,
  (e, old) => {
    old?.off('update', schedule)
    e?.on('update', schedule)
    collect()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  editor.value?.off('update', schedule)
  clearTimeout(timer)
})
</script>

<template>
  <OutlinePanel
    :items="entries"
    :active="active"
    :pinned="prefs.editorOutline"
    empty-text="添加标题后，这里会显示大纲"
    @pin="(v) => (prefs.editorOutline = v)"
    @go="go"
  />
</template>
