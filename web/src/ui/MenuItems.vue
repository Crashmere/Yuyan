<script setup lang="ts">
import {
  DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from 'reka-ui'
import { Check, ChevronRight } from 'lucide-vue-next'
import { vHalfRow } from './halfRow'
import type { MenuEntry } from './menu'

// The entries of a dropdown menu, with submenus; used by ActionMenu.
defineOptions({ name: 'MenuItems' })
defineProps<{ items: MenuEntry[] }>()
</script>

<template>
  <template v-for="(item, i) in items" :key="i">
    <DropdownMenuSeparator v-if="!item" class="yy-menu-sep" />
    <DropdownMenuSub v-else-if="item.children">
      <DropdownMenuSubTrigger class="yy-menu-item" :disabled="item.disabled">
        <component :is="item.icon" v-if="item.icon" :size="16" />
        <span>{{ item.label }}</span>
        <ChevronRight :size="14" class="yy-menu-arrow" />
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent v-half-row class="yy-menu" :side-offset="4">
          <MenuItems :items="item.children" />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
    <DropdownMenuItem v-else class="yy-menu-item" :class="{ danger: item.danger }" :disabled="item.disabled" @select="item.run?.()">
      <component :is="item.icon" v-if="item.icon" :size="16" />
      <span>{{ item.label }}</span>
      <kbd v-if="item.hint">{{ item.hint }}</kbd>
      <span v-if="item.description" class="yy-menu-description">{{ item.description }}</span>
      <Check v-if="item.checked" :size="15" class="yy-menu-check" />
    </DropdownMenuItem>
  </template>
</template>
