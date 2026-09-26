<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-vue-next'
import { toast } from '../ui/toast'
import { useEditorContext } from './context'
import { clearSearch, gotoMatch, replaceAll, replaceCurrent, searchState, setSearch } from './search'

// The find and replace panel, opened with Cmd/Ctrl+F.
const emit = defineEmits<{ close: [] }>()
const { editor, tick } = useEditorContext()

const term = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const findInput = ref<HTMLInputElement | null>(null)

const status = computed(() => {
  void tick.value
  const e = editor.value
  if (!e || !term.value) return ''
  const s = searchState(e.state)
  return s.matches.length ? `${s.current + 1} / ${s.matches.length}` : '无结果'
})

watch([term, caseSensitive], ([t, c]) => {
  if (editor.value) setSearch(editor.value.view, t, c)
})

function focusFind() {
  findInput.value?.focus()
  findInput.value?.select()
}

defineExpose({ focusFind })

function onFindKey(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    if (editor.value) gotoMatch(editor.value.view, e.shiftKey ? -1 : 1)
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.isComposing) {
    e.preventDefault()
    close()
  }
}

function replaceOne() {
  if (editor.value) replaceCurrent(editor.value.view, replacement.value)
}

function replaceEvery() {
  if (!editor.value) return
  const n = replaceAll(editor.value.view, replacement.value)
  toast(n ? `已替换 ${n} 处` : '没有可替换的内容', n ? 'success' : 'info')
}

function close() {
  if (editor.value) {
    clearSearch(editor.value.view)
    editor.value.commands.focus()
  }
  emit('close')
}

onMounted(async () => {
  const e = editor.value
  if (e) {
    const { from, to } = e.state.selection
    const selected = e.state.doc.textBetween(from, to, '\n')
    if (selected && !selected.includes('\n') && selected.length <= 200) term.value = selected
  }
  await nextTick()
  focusFind()
})
onBeforeUnmount(() => {
  if (editor.value && !editor.value.isDestroyed) clearSearch(editor.value.view)
})
</script>

<template>
  <div class="yy-find" role="search" @keydown="onKey">
    <div class="yy-find-row">
      <input ref="findInput" v-model="term" class="yy-input" placeholder="查找" aria-label="查找" @keydown="onFindKey" />
      <span class="yy-find-status">{{ status }}</span>
      <button type="button" class="yy-icon-btn small" :class="{ active: caseSensitive }" title="区分大小写" @click="caseSensitive = !caseSensitive"><CaseSensitive :size="16" /></button>
      <button type="button" class="yy-icon-btn small" title="上一个（Shift+Enter）" @click="editor && gotoMatch(editor.view, -1)"><ChevronUp :size="16" /></button>
      <button type="button" class="yy-icon-btn small" title="下一个（Enter）" @click="editor && gotoMatch(editor.view, 1)"><ChevronDown :size="16" /></button>
      <button type="button" class="yy-icon-btn small" title="关闭（Esc）" @click="close"><X :size="16" /></button>
    </div>
    <div class="yy-find-row">
      <input v-model="replacement" class="yy-input" placeholder="替换为" aria-label="替换为" @keydown.enter.prevent="!$event.isComposing && replaceOne()" />
      <button type="button" class="yy-btn small" @click="replaceOne">替换</button>
      <button type="button" class="yy-btn small" @click="replaceEvery">全部替换</button>
    </div>
  </div>
</template>
