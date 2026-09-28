<script setup lang="ts">
import {
  ContextMenuItem, ContextMenuPortal, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from 'reka-ui'
import { Check, ChevronRight } from 'lucide-vue-next'
import { vHalfRow } from './halfRow'
import type { MenuEntry } from './menu'

defineOptions({ name: 'ContextMenuItems' })
defineProps<{ items: MenuEntry[] }>()
</script>

<template>
  <template v-for="(item, i) in items" :key="i">
    <ContextMenuSeparator v-if="!item" class="yy-menu-sep" />
    <ContextMenuSub v-else-if="item.children">
      <ContextMenuSubTrigger class="yy-menu-item" :disabled="item.disabled">
        <component :is="item.icon" v-if="item.icon" :size="16" />
        <span>{{ item.label }}</span>
        <ChevronRight :size="14" class="yy-menu-arrow" />
      </ContextMenuSubTrigger>
      <ContextMenuPortal>
        <ContextMenuSubContent v-half-row class="yy-menu" :side-offset="4">
          <ContextMenuItems :items="item.children" />
        </ContextMenuSubContent>
      </ContextMenuPortal>
    </ContextMenuSub>
    <ContextMenuItem v-else class="yy-menu-item" :class="{ danger: item.danger }" :disabled="item.disabled" @select="item.run?.()">
      <component :is="item.icon" v-if="item.icon" :size="16" />
      <span>{{ item.label }}</span>
      <kbd v-if="item.hint">{{ item.hint }}</kbd>
      <span v-if="item.description" class="yy-menu-description">{{ item.description }}</span>
      <Check v-if="item.checked" :size="15" class="yy-menu-check" />
    </ContextMenuItem>
  </template>
</template>
