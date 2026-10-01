<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, FileText, Hash } from 'lucide-vue-next'
import { api, errorMessage } from '../shared/api'
import { linkChoices, type LinkChoice, type LinkTarget } from '../shared/internalLinks'
import { setupLinkPreviews } from '../shared/linkPreview'

const props = defineProps<{ query: string; command: (choice: LinkChoice) => void }>()
const docs = ref<LinkTarget[]>([]), failure = ref(''), busy = ref(true), selected = ref(0), expanded = ref<number | null>(null)
const root = ref<HTMLElement | null>(null)
const items = computed(() => linkChoices(docs.value, props.query, expanded.value))
let cleanup = () => {}, alive = true
onMounted(async () => {
  if (root.value) cleanup = setupLinkPreviews(root.value)
  try { const result = await api<LinkTarget[]>('link-targets'); if (alive) docs.value = result }
  catch (e) { if (alive) failure.value = errorMessage(e) }
  finally { busy.value = false }
})
onBeforeUnmount(() => { alive = false; cleanup() })
function expand(choice: LinkChoice) { expanded.value = expanded.value === choice.doc.id ? null : choice.doc.id }
function handleKey(e: KeyboardEvent): boolean {
  if (e.isComposing) return false
  const count = items.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    selected.value = count ? (selected.value + (e.key === 'ArrowDown' ? 1 : count - 1)) % count : 0
    void nextTick(() => root.value?.querySelector(`[data-index="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter') { const choice = items.value[selected.value]; if (choice) props.command(choice) }
  else if (e.key === 'ArrowRight' && !props.query && items.value[selected.value]?.doc.headings.length) expand(items.value[selected.value]!)
  else if (e.key === 'ArrowLeft' && expanded.value) expanded.value = null
  else return false
  return true
}
// Reset when a query changes, including transitions to an empty result set.
watch(() => props.query, () => { selected.value = 0 })
watch(items, () => { selected.value = Math.min(selected.value, Math.max(0, items.value.length - 1)) })
defineExpose({ onKeyDown: handleKey })
</script>

<template>
  <div ref="root" class="yy-doc-link-picker" role="listbox" aria-label="选择文档或章节">
    <div class="yy-picker-hint">文档与章节 · 支持拼音和首字母</div>
    <p v-if="busy || failure || !items.length" class="yy-picker-empty">{{ busy ? '正在加载…' : failure || '没有匹配的文档或章节' }}</p>
    <div v-for="(item, index) in items" :key="item.href" class="yy-doc-link-row" :class="{ active: index === selected }" :data-index="index" @mouseenter="selected = index">
      <button type="button" role="option" :aria-selected="index === selected" :data-preview-href="item.href" @mousedown.prevent @click="command(item)">
        <component :is="item.heading ? Hash : FileText" :size="16" />
        <span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span>
      </button>
      <button v-if="!item.heading && item.doc.headings.length && !query" type="button" class="yy-link-chapters" data-tip="展开章节" aria-label="展开章节" :aria-expanded="expanded === item.doc.id" @mousedown.prevent @click="expand(item)"><ChevronDown :size="15" :class="{ expanded: expanded === item.doc.id }" /></button>
    </div>
  </div>
</template>
