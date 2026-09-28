<script setup lang="ts">
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import ContextMenuItems from './ContextMenuItems.vue'
import { vHalfRow } from './halfRow'
import type { MenuEntry } from './menu'

// A right-click menu for the element in the default slot, with the same entries as ActionMenu.
defineProps<{ items: MenuEntry[]; disabled?: boolean }>()
const emit = defineEmits<{ open: [boolean] }>()
</script>

<template>
  <ContextMenuRoot :modal="false" @update:open="(v) => emit('open', v)">
    <ContextMenuTrigger as-child :disabled="disabled">
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent v-half-row class="yy-menu">
        <ContextMenuItems :items="items" />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
