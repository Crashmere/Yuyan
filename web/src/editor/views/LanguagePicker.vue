<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { Check, ChevronDown } from 'lucide-vue-next'
import { languageLabel, searchLanguages } from '../languages'

// Picks a code block's language by typing part of its name or alias.
const props = defineProps<{ value: string }>()
const emit = defineEmits<{ change: [string]; done: [] }>()

const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const results = computed(() => searchLanguages(query.value, props.value))
const portalTarget = computed(() => open.value ? document.querySelector<HTMLElement>('.yy-code-dialog[open]') ?? 'body' : 'body')

watch(open, (o) => {
  if (!o) return
  query.value = ''
  active.value = Math.max(0, results.value.findIndex((l) => l.id === props.value.toLowerCase()))
})
watch(query, () => (active.value = 0))
watch(active, async (i) => {
  await nextTick()
  list.value?.children[i]?.scrollIntoView({ block: 'nearest' })
})

function pick(id: string) {
  open.value = false
  if (id !== props.value) emit('change', id)
  emit('done')
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return
  const n = results.value.length
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    active.value = (active.value + n - 1) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const hit = results.value[active.value]
    if (hit) pick(hit.id)
    else if (query.value.trim()) pick(query.value.trim().toLowerCase())
  }
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger class="yy-lang-trigger" aria-label="代码语言">
      {{ languageLabel(value) }}<ChevronDown :size="12" />
    </PopoverTrigger>
    <PopoverPortal :to="portalTarget">
      <PopoverContent class="yy-float yy-lang-panel" align="start" :side-offset="4" @open-auto-focus.prevent="input?.focus()" @close-auto-focus.prevent>
        <input ref="input" v-model="query" class="yy-input" placeholder="搜索语言，如 js、py" aria-label="搜索语言" @keydown="onKey" />
        <div ref="list" class="yy-lang-list" role="listbox" aria-label="代码语言">
          <button
            v-for="(l, i) in results"
            :key="l.id"
            type="button"
            role="option"
            :aria-selected="i === active"
            :class="{ active: i === active }"
            @mouseenter="active = i"
            @click="pick(l.id)"
          >
            <span>{{ l.label }}</span>
            <span class="yy-lang-id">{{ l.id }}</span>
            <Check v-if="l.id === value.toLowerCase()" :size="14" class="yy-lang-check" />
          </button>
          <p v-if="!results.length" class="yy-lang-empty">按 Enter 使用“{{ query.trim() }}”</p>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
