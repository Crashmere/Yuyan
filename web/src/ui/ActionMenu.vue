<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { vHalfRow } from './halfRow'
import type { MenuEntry } from './menu'
import MenuItems from './MenuItems.vue'

// A dropdown menu opened from the element in the default slot. Menus used inside the editor set
// restoreFocus to false, so closing them leaves focus with the editor instead of the trigger.
const props = withDefaults(defineProps<{ items: MenuEntry[]; align?: 'start' | 'center' | 'end'; restoreFocus?: boolean; contentClass?: string }>(), {
  align: 'end',
  restoreFocus: true,
})
const open = defineModel<boolean>('open', { default: false })

function onCloseAutoFocus(e: Event) {
  if (!props.restoreFocus) e.preventDefault()
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent v-half-row class="yy-menu" :class="contentClass" :align="align" :side-offset="4" @click.stop @close-auto-focus="onCloseAutoFocus">
        <MenuItems :items="items" />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
