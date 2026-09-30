<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onOutside, place, type Anchor } from './floating'

// Picks the size and optional first header row of a new table.
const props = defineProps<{ anchor: Anchor }>()
const emit = defineEmits<{ pick: [rows: number, cols: number, header: boolean]; close: [] }>()
const header = ref(true)

const rows = 8
const cols = 10
const panel = ref<HTMLElement | null>(null)
const hover = ref({ r: 1, c: 1 })
let unplace = () => {}
let unoutside = () => {}

function key(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) return
  // Keep the editor selection in place while the picker owns these keys.
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.key === 'Escape') { emit('close'); return }
  if (e.key === 'Enter') { emit('pick', hover.value.r, hover.value.c, header.value); return }
  const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
  const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
  hover.value = { r: Math.max(1, Math.min(rows, hover.value.r + dr)), c: Math.max(1, Math.min(cols, hover.value.c + dc)) }
}

onMounted(() => {
  if (panel.value) unplace = place(panel.value, props.anchor)
  unoutside = onOutside(() => panel.value, () => emit('close'))
  document.addEventListener('keydown', key, true)
})
onBeforeUnmount(() => {
  unplace()
  unoutside()
  document.removeEventListener('keydown', key, true)
})
</script>

<template>
  <div ref="panel" class="yy-float yy-table-grid" role="dialog" aria-label="插入表格">
    <div class="yy-table-grid-cells" :style="{ gridTemplateColumns: `repeat(${cols}, 18px)` }">
      <template v-for="r in rows" :key="r">
        <button
          v-for="c in cols"
          :key="c"
          type="button"
          :class="{ on: r <= hover.r && c <= hover.c }"
          :aria-label="`${r} 行 ${c} 列`"
          @mouseenter="hover = { r, c }"
          @mousedown.prevent
          @click="emit('pick', r, c, header)"
        ></button>
      </template>
    </div>
    <div class="yy-table-grid-label" aria-live="polite">{{ hover.r }} 行 × {{ hover.c }} 列</div>
    <label class="yy-table-header-option"><input v-model="header" type="checkbox" />第一行为表头</label>
  </div>
</template>
