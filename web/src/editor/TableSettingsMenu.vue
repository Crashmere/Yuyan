<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, TableProperties } from 'lucide-vue-next'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import { vHalfRow } from '../ui/halfRow'

const props = defineProps<{ compact?: boolean; disabled?: boolean; rowCount: number; headerRows: number | null }>()
const emit = defineEmits<{ remember: []; select: [count: number] }>()
const open = defineModel<boolean>('open', { default: false })
const trigger = ref<HTMLButtonElement | null>(null)
const remembered = ref<{ rowCount: number; headerRows: number | null }>({ rowCount: 0, headerRows: 0 })
const rowCount = computed(() => open.value ? remembered.value.rowCount : props.rowCount)
const headerRows = computed(() => open.value ? remembered.value.headerRows : props.headerRows)
const options = computed(() => Array.from({ length: rowCount.value + 1 }, (_, count) => ({
  count,
  label: count === 0 ? '无标题行' : `${count} 行`,
})))

function remember() {
  remembered.value = { rowCount: props.rowCount, headerRows: props.headerRows }
  emit('remember')
}

function toggle() {
  if (!open.value) remember()
  open.value = !open.value
}

function choose(count: number) {
  open.value = false
  emit('select', count)
}
function onInteractOutside(e: Event) {
  if (trigger.value && e.target instanceof Node && trigger.value.contains(e.target)) return
  open.value = false
}
</script>

<template>
  <PopoverRoot :open="open">
    <PopoverAnchor as-child>
      <button
        ref="trigger"
        type="button"
        :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'"
        aria-label="表格设置"
        data-tip="表格设置"
        :disabled="disabled"
        :aria-expanded="open"
        @mousedown.prevent="remember"
        @click="toggle"
      >
        <TableProperties :size="17" />
      </button>
    </PopoverAnchor>
    <PopoverPortal :disabled="compact">
      <PopoverContent
        v-half-row
        class="yy-menu yy-table-settings-menu"
        side="bottom"
        align="center"
        :side-offset="4"
        :collision-padding="8"
        aria-label="表格设置"
        @open-auto-focus.prevent
        @close-auto-focus.prevent
        @interact-outside="onInteractOutside"
        @escape-key-down="open = false"
      >
        <div class="yy-menu-label">标题行</div>
        <button
          v-for="item in options"
          :key="item.count"
          type="button"
          role="menuitemradio"
          class="yy-menu-item"
          :aria-checked="headerRows === item.count"
          @mousedown.prevent
          @click="choose(item.count)"
        >
          <span>{{ item.label }}</span>
          <Check v-if="headerRows === item.count" :size="15" class="yy-menu-check" />
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
