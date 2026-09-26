<script setup lang="ts">
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger } from 'reka-ui'
import { vHalfRow } from './halfRow'
import type { MenuEntry } from './menu'

// A right-click menu for the element in the default slot, with the same entries as ActionMenu.
defineProps<{ items: MenuEntry[] }>()
const emit = defineEmits<{ open: [boolean] }>()
</script>

<template>
  <ContextMenuRoot :modal="false" @update:open="(v) => emit('open', v)">
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent v-half-row class="yy-menu">
        <template v-for="(item, i) in items" :key="i">
          <ContextMenuSeparator v-if="!item" class="yy-menu-sep" />
          <ContextMenuItem v-else class="yy-menu-item" :class="{ danger: item.danger }" :disabled="item.disabled" @select="item.run?.()">
            <component :is="item.icon" v-if="item.icon" :size="16" />
            <span>{{ item.label }}</span>
            <kbd v-if="item.hint">{{ item.hint }}</kbd>
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
