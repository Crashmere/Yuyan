<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { Check, ChevronDown } from 'lucide-vue-next'
import { languageLabel, searchLanguages } from '../languages'
import { containMenuWheel } from '../../ui/menuWheel'

// Picks a code block's language by typing part of its name or alias.
const props = defineProps<{ value: string }>()
const emit = defineEmits<{ change: [string]; done: [] }>()

const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const trigger = ref<InstanceType<typeof PopoverTrigger> | null>(null)
const results = computed(() => searchLanguages(query.value, props.value))
const portalTarget = computed(() => open.value ? document.querySelector<HTMLElement>('.yy-code-dialog[open]') ?? 'body' : 'body')

watch(open, async (o, _previous, onCleanup) => {
  if (!o) return
  const closeDetached = () => {
    const button = trigger.value?.$el as HTMLElement | undefined
    if (!button) return
    const rect = button.getBoundingClientRect()
    const top = button.closest('dialog') ? 8 : ((document.querySelector('.yy-toolbar') ?? document.querySelector('.yy-topbar'))?.getBoundingClientRect().bottom ?? 0) + 8
    if (rect.bottom <= top || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) open.value = false
  }
  document.addEventListener('scroll', closeDetached, true)
  window.addEventListener('resize', closeDetached)
  onCleanup(() => { document.removeEventListener('scroll', closeDetached, true); window.removeEventListener('resize', closeDetached) })
  query.value = ''
  active.value = Math.max(0, results.value.findIndex((l) => l.id === props.value.toLowerCase()))
  await nextTick()
  revealActive()
})
watch(query, () => { active.value = 0; if (list.value) list.value.scrollTop = 0 })

function revealActive() {
  const scroller = list.value, item = scroller?.children[active.value] as HTMLElement | undefined
  if (!scroller || !item) return
  const parent = scroller.getBoundingClientRect(), rect = item.getBoundingClientRect()
  if (rect.top < parent.top) scroller.scrollTop += rect.top - parent.top
  else if (rect.bottom > parent.bottom) scroller.scrollTop += rect.bottom - parent.bottom
}

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
    revealActive()
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    active.value = (active.value + n - 1) % n
    revealActive()
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
    <PopoverTrigger ref="trigger" class="yy-lang-trigger" aria-label="代码语言">
      {{ languageLabel(value) }}<ChevronDown :size="12" />
    </PopoverTrigger>
    <PopoverPortal :to="portalTarget">
      <PopoverContent class="yy-float yy-lang-panel" align="start" :side-offset="4" hide-when-detached update-position-strategy="always" @wheel="containMenuWheel" @open-auto-focus.prevent="input?.focus({ preventScroll: true })" @close-auto-focus.prevent>
        <input ref="input" v-model="query" class="yy-input" placeholder="搜索语言，如 js、py" aria-label="搜索语言" @keydown="onKey" />
        <div ref="list" class="yy-lang-list" role="listbox" aria-label="代码语言" data-menu-scroll>
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
