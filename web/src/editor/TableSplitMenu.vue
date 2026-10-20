<script setup lang="ts">
import { computed, ref } from 'vue'
import { Columns2, Rows2 } from 'lucide-vue-next'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'

const props = defineProps<{ compact?: boolean; disabled?: boolean; directional: boolean; merged: boolean }>()
const emit = defineEmits<{ remember: []; horizontal: []; vertical: []; unmerge: [] }>()
const open = defineModel<boolean>('open', { default: false })
const remembered = ref({ directional: false, merged: false })
const directional = computed(() => open.value ? remembered.value.directional : props.directional)
const merged = computed(() => open.value ? remembered.value.merged : props.merged)

function remember() {
  remembered.value = { directional: props.directional, merged: props.merged }
  emit('remember')
}

function toggle() {
  if (!open.value) remember()
  open.value = !open.value
}

function choose(action: 'horizontal' | 'vertical' | 'unmerge') {
  open.value = false
  if (action === 'horizontal') emit('horizontal')
  else if (action === 'vertical') emit('vertical')
  else emit('unmerge')
}
</script>

<template>
  <PopoverRoot :open="open">
    <PopoverAnchor as-child>
      <button
        type="button"
        :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'"
        aria-label="拆分单元格"
        data-tip="拆分单元格"
        :disabled="disabled"
        :aria-expanded="open"
        @pointerdown.prevent.stop="toggle"
        @mousedown.prevent.stop
        @click.prevent.stop
        @keydown.enter.prevent="toggle"
        @keydown.space.prevent="toggle"
      >
        <Columns2 :size="17" />
      </button>
    </PopoverAnchor>
    <PopoverPortal>
      <PopoverContent
        class="yy-menu yy-table-split-menu"
        side="bottom"
        align="center"
        :side-offset="4"
        :collision-padding="8"
        aria-label="拆分单元格"
        @open-auto-focus.prevent
        @close-auto-focus.prevent
        @interact-outside="open = false"
        @escape-key-down="open = false"
      >
        <button type="button" class="yy-menu-item" :data-disabled="!directional || undefined" :disabled="!directional" @pointerdown.prevent @mousedown.prevent @click="choose('horizontal')">
          <Columns2 :size="16" />
          <span>横向拆分</span>
          <span class="yy-menu-description">拆成左右两格</span>
        </button>
        <button type="button" class="yy-menu-item" :data-disabled="!directional || undefined" :disabled="!directional" @pointerdown.prevent @mousedown.prevent @click="choose('vertical')">
          <Rows2 :size="16" />
          <span>纵向拆分</span>
          <span class="yy-menu-description">拆成上下两格</span>
        </button>
        <div class="yy-menu-sep"></div>
        <button type="button" class="yy-menu-item" :data-disabled="!merged || undefined" :disabled="!merged" @pointerdown.prevent @mousedown.prevent @click="choose('unmerge')">
          <span>取消合并单元格</span>
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
