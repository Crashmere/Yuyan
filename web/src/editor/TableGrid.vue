<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onOutside, place, type Anchor } from './floating'

// Picks the size of a new table by hovering over a grid. The first row is the header row, which
// Markdown tables always have.
const props = defineProps<{ anchor: Anchor }>()
const emit = defineEmits<{ pick: [rows: number, cols: number]; close: [] }>()

const rows = 8
const cols = 10
const panel = ref<HTMLElement | null>(null)
const hover = ref({ r: 0, c: 0 })
let unplace = () => {}
let unoutside = () => {}

function key(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  if (panel.value) unplace = place(panel.value, props.anchor)
  unoutside = onOutside(() => panel.value, () => emit('close'))
  document.addEventListener('keydown', key)
})
onBeforeUnmount(() => {
  unplace()
  unoutside()
  document.removeEventListener('keydown', key)
})
</script>

<template>
  <div ref="panel" class="yy-float yy-table-grid" role="dialog" aria-label="插入表格">
    <div class="yy-table-grid-cells" :style="{ gridTemplateColumns: `repeat(${cols}, 18px)` }" @mouseleave="hover = { r: 0, c: 0 }">
      <template v-for="r in rows" :key="r">
        <button
          v-for="c in cols"
          :key="c"
          type="button"
          :class="{ on: r <= hover.r && c <= hover.c }"
          :aria-label="`${r} 行 ${c} 列`"
          @mouseenter="hover = { r, c }"
          @mousedown.prevent
          @click="emit('pick', r, c)"
        ></button>
      </template>
    </div>
    <div class="yy-table-grid-label">{{ hover.r ? `${hover.r} 行 × ${hover.c} 列（第一行为表头）` : '选择表格大小' }}</div>
  </div>
</template>
