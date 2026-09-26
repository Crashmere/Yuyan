<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditorContext } from './context'

// The outline beside the editor. Headings are collected a moment after typing stops, so long
// documents stay responsive; the heading at the top of the window is highlighted.
const emit = defineEmits<{ navigate: [] }>()
const { editor } = useEditorContext()

interface Entry {
  level: number
  text: string
  pos: number
}

const entries = ref<Entry[]>([])
const active = ref(-1)
const minLevel = computed(() => Math.min(...entries.value.map((h) => h.level)))
let timer: ReturnType<typeof setTimeout> | undefined
let frame = 0

function collect() {
  const e = editor.value
  if (!e) return
  const out: Entry[] = []
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ level: node.attrs.level as number, text: node.textContent.trim() || '（空标题）', pos })
      return false
    }
    return !node.isTextblock
  })
  entries.value = out
  track()
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(collect, 300)
}

// The last heading above a line just below the toolbars is the one being read.
function track() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const e = editor.value
    if (!e) return
    const line = 140
    let current = -1
    entries.value.forEach((h, i) => {
      const dom = e.view.nodeDOM(h.pos)
      if (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= line) current = i
    })
    active.value = current
  })
}

function go(h: Entry) {
  const e = editor.value
  if (!e) return
  const dom = e.view.nodeDOM(h.pos)
  if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
  e.commands.setTextSelection(h.pos + 1)
  emit('navigate')
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
onMounted(() => window.addEventListener('scroll', track, { passive: true }))
onBeforeUnmount(() => {
  editor.value?.off('update', schedule)
  window.removeEventListener('scroll', track)
  clearTimeout(timer)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <nav class="yy-toc" aria-label="大纲">
    <div class="yy-toc-head"><span class="yy-toc-title">大纲</span></div>
    <ul v-if="entries.length">
      <li v-for="(h, i) in entries" :key="`${h.pos}-${i}`" :style="{ '--level': h.level - minLevel }">
        <a href="#" :class="{ active: active === i }" :title="h.text" @click.prevent="go(h)">{{ h.text }}</a>
      </li>
    </ul>
    <p v-else class="yy-toc-empty">添加标题后，这里会显示大纲</p>
  </nav>
</template>
