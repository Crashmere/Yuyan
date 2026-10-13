<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Eye, EyeOff, GripVertical } from 'lucide-vue-next'
import FoldAllButton from '../../ui/FoldAllButton.vue'
import IconButton from '../../ui/IconButton.vue'

// The outline of a reading page or the editor. As in Yuque, the eye beside its title only pins it:
// unpinned, it shows as a line per heading and opens over them while the pointer is near
// (app.css). Entries with deeper headings after them fold, one by one or all at once.
export interface OutlineEntry {
  key: string
  level: number
  text: string
  href?: string
}

const props = defineProps<{ items: OutlineEntry[]; active: number; pinned: boolean; emptyText?: string; reorderable?: boolean }>()
const emit = defineEmits<{ go: [index: number]; pin: [pinned: boolean] }>()

const folded = reactive(new Set<string>())
const minLevel = computed(() => Math.min(...props.items.map((h) => h.level)))
const parents = computed(() => props.items.map((h, i) => (props.items[i + 1]?.level ?? 0) > h.level))

// An entry is hidden under a folded entry before it with a lower level; the highlight then moves
// to the entry that hides it.
const shownBy = computed(() => {
  const stack: { level: number; index: number; folded: boolean }[] = []
  return props.items.map((h, i) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    const hider = stack.find((s) => s.folded)
    stack.push({ level: h.level, index: i, folded: folded.has(h.key) })
    return hider ? hider.index : i
  })
})
const highlighted = computed(() => (props.active < 0 ? -1 : shownBy.value[props.active]))
// Hidden descendants do not count as expanded: once every visible branch is closed, offer to open all.
const hasExpanded = computed(() => props.items.some((h, i) => parents.value[i] && shownBy.value[i] === i && !folded.has(h.key)))

function toggle(key: string) {
  if (folded.has(key)) folded.delete(key)
  else folded.add(key)
}
function toggleAll() {
  if (hasExpanded.value) props.items.forEach((h, i) => parents.value[i] && folded.add(h.key))
  else folded.clear()
}

// A long outline follows the page: when the highlighted entry leaves the outline's scrolled area
// it is brought to the middle, showing the sections ahead. Never while the pointer is over the
// outline, where the list would move under it. Unpinned, the panel keeps its layout while hidden,
// so it opens with the entry in view.
const nav = ref<HTMLElement>()
let pointerInside = false
function hover(inside: boolean) {
  pointerInside = inside
}
function scroller(): HTMLElement | undefined {
  const panel = nav.value?.querySelector<HTMLElement>('.yy-toc-panel')
  if (panel && panel.scrollHeight > panel.clientHeight) return panel
  const aside = nav.value?.closest<HTMLElement>('.yy-doc-aside')
  return aside && aside.scrollHeight > aside.clientHeight ? aside : undefined
}
function reveal() {
  const entry = nav.value?.querySelector<HTMLElement>('a.active'), box = scroller()
  if (pointerInside || !entry || !box) return
  const view = box.getBoundingClientRect(), item = entry.getBoundingClientRect()
  // The sticky head covers the top of the scrolled area.
  const top = view.top + (nav.value!.querySelector('.yy-toc-head')?.getBoundingClientRect().height ?? 0)
  if (item.top < top || item.bottom > view.bottom) box.scrollTop += item.top + item.height / 2 - (top + view.bottom) / 2
}
watch([highlighted, () => props.pinned], reveal, { flush: 'post' })
// Also when the outline appears, as the drawer on narrow screens, or changes size.
const resized = new ResizeObserver(() => reveal())
onMounted(() => resized.observe(nav.value!))
onBeforeUnmount(() => resized.disconnect())
</script>

<template>
  <nav ref="nav" class="yy-toc" :class="{ 'is-peek': !pinned, 'can-reorder': reorderable }" aria-label="大纲" @pointerenter="hover(true)" @pointerleave="hover(false)">
    <div v-if="!pinned && items.length" class="yy-toc-lines" tabindex="0" aria-label="大纲">
      <span v-for="(h, i) in items" :key="h.key" :class="{ active: i === active }" :style="{ '--level': h.level - minLevel }"></span>
    </div>
    <div class="yy-toc-panel">
      <div class="yy-toc-head">
        <span class="yy-toc-title">大纲</span>
        <IconButton small class="yy-toc-eye" :label="pinned ? '隐藏大纲' : '固定显示大纲'" @click="emit('pin', !pinned)">
          <Eye v-if="pinned" :size="14" /><EyeOff v-else :size="14" />
        </IconButton>
        <span v-if="parents.some(Boolean)" class="yy-toc-tools">
          <FoldAllButton :expanded="hasExpanded" @click="toggleAll" />
        </span>
      </div>
      <ul v-if="items.length">
        <template v-for="(h, i) in items" :key="h.key">
          <li v-if="shownBy[i] === i" :style="{ '--level': h.level - minLevel }" :data-outline-key="h.key">
            <button
              v-if="parents[i]"
              type="button"
              class="yy-toc-caret"
              :class="{ folded: folded.has(h.key) }"
              :aria-label="folded.has(h.key) ? '展开' : '折叠'"
              :aria-expanded="!folded.has(h.key)"
              @click="toggle(h.key)"
            ></button>
            <a :href="h.href ?? '#'" :draggable="false" :class="{ active: i === highlighted }" :title="h.text" @click.prevent="emit('go', i)">{{ h.text }}</a>
            <button v-if="reorderable" type="button" class="yy-toc-drag" aria-label="拖动这一节" data-tip="拖动标题及其下全部内容" @click.prevent><GripVertical :size="14" /></button>
          </li>
        </template>
      </ul>
      <p v-else class="yy-toc-empty">{{ emptyText }}</p>
    </div>
  </nav>
</template>
