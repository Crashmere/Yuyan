<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SlashEntry } from './slash'

const props = defineProps<{ items: SlashEntry[]; command: (item: SlashEntry) => void }>()
const selected = ref(0)
const list = ref<HTMLElement | null>(null)

// A group header is shown where the group changes; recently used items come first.
const rows = computed(() =>
  props.items.map((item, i) => {
    const group = item.recent ? '最近使用' : item.group
    const prev = props.items[i - 1]
    const prevGroup = prev ? (prev.recent ? '最近使用' : prev.group) : null
    return { item, index: i, header: group !== prevGroup ? group : null }
  }),
)

watch(() => props.items, () => (selected.value = 0))
watch(selected, (i) => list.value?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' }))

function choose(i: number) {
  const item = props.items[i]
  if (item) props.command(item)
}

function onKeyDown(e: KeyboardEvent): boolean {
  const n = props.items.length
  if (!n || e.isComposing) return false
  if (e.key === 'ArrowDown') selected.value = (selected.value + 1) % n
  else if (e.key === 'ArrowUp') selected.value = (selected.value + n - 1) % n
  else if (e.key === 'Enter') choose(selected.value)
  else return false
  return true
}

defineExpose({ onKeyDown })
</script>

<template>
  <div class="yy-slash" role="listbox" aria-label="插入">
    <div ref="list">
      <template v-for="row in rows" :key="`${row.item.recent ? 'r' : ''}${row.item.id}`">
        <div v-if="row.header" class="yy-slash-group">{{ row.header }}</div>
        <button
          type="button"
          role="option"
          :data-index="row.index"
          :aria-selected="row.index === selected"
          :class="{ active: row.index === selected }"
          @mousedown.prevent="choose(row.index)"
          @mouseenter="selected = row.index"
        >
          <span class="yy-slash-icon"><component :is="row.item.icon" :size="17" /></span>
          <span class="yy-slash-text">
            <span class="yy-slash-title">{{ row.item.label }}</span>
            <span class="yy-slash-desc">{{ row.item.description }}</span>
          </span>
          <kbd v-if="row.item.markdown">{{ row.item.markdown }}</kbd>
        </button>
      </template>
    </div>
    <div v-if="!items.length" class="yy-slash-empty">没有匹配的内容</div>
  </div>
</template>
