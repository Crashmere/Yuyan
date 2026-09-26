<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SlashItem } from './slash'

const props = defineProps<{ items: SlashItem[]; command: (item: SlashItem) => void }>()
const selected = ref(0)
const list = ref<HTMLElement | null>(null)

watch(() => props.items, () => (selected.value = 0))
watch(selected, (i) => list.value?.children[i]?.scrollIntoView({ block: 'nearest' }))

function choose(i: number) {
  const item = props.items[i]
  if (item) props.command(item)
}

function onKeyDown(e: KeyboardEvent): boolean {
  const n = props.items.length
  if (!n) return false
  if (e.key === 'ArrowDown') selected.value = (selected.value + 1) % n
  else if (e.key === 'ArrowUp') selected.value = (selected.value + n - 1) % n
  else if (e.key === 'Enter') choose(selected.value)
  else return false
  return true
}

defineExpose({ onKeyDown })
</script>

<template>
  <div class="yy-slash">
    <div ref="list">
      <button
        v-for="(item, i) in items"
        :key="item.title"
        type="button"
        :class="{ active: i === selected }"
        @mousedown.prevent="choose(i)"
        @mouseenter="selected = i"
      >
        <span>{{ item.title }}</span>
        <kbd>{{ item.hint }}</kbd>
      </button>
    </div>
    <div v-if="!items.length" class="yy-slash-empty">没有匹配的内容</div>
  </div>
</template>
