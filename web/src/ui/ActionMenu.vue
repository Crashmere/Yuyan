<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui'
import type { MenuEntry } from './menu'

// A dropdown menu opened from the element in the default slot.
withDefaults(defineProps<{ items: MenuEntry[]; align?: 'start' | 'center' | 'end' }>(), { align: 'end' })
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="yy-menu" :align="align" :side-offset="4" @click.stop>
        <template v-for="(item, i) in items" :key="i">
          <DropdownMenuSeparator v-if="!item" class="yy-menu-sep" />
          <DropdownMenuItem v-else class="yy-menu-item" :class="{ danger: item.danger }" :disabled="item.disabled" @select="item.run()">
            <component :is="item.icon" v-if="item.icon" :size="16" />
            <span>{{ item.label }}</span>
            <kbd v-if="item.hint">{{ item.hint }}</kbd>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
