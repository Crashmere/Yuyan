<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { vHalfRow } from './halfRow'
import type { MenuEntry } from './menu'
import MenuItems from './MenuItems.vue'

// reka-ui's dropdown menu behind ActionMenu, which puts it in place the first time the menu opens.
// Menus used inside the editor set restoreFocus to false, so closing them leaves focus with the
// editor instead of the trigger.
const props = withDefaults(defineProps<{ items: MenuEntry[]; align?: 'start' | 'center' | 'end'; restoreFocus?: boolean; contentClass?: string; openKey?: string }>(), {
  align: 'end',
  restoreFocus: true,
})
const open = defineModel<boolean>('open', { default: false })
const trigger = ref<InstanceType<typeof DropdownMenuTrigger>>()

// A menu first opened from the keyboard replays that key on reka-ui's trigger, which then opens it
// as a keyboard user expects, with the first item focused.
onMounted(() => {
  const el: unknown = trigger.value?.$el
  if (!props.openKey || !(el instanceof HTMLElement)) return
  el.focus({ preventScroll: true })
  el.dispatchEvent(new KeyboardEvent('keydown', { key: props.openKey, bubbles: true, cancelable: true }))
})

function onCloseAutoFocus(e: Event) {
  if (!props.restoreFocus) e.preventDefault()
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger ref="trigger" as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent v-half-row class="yy-menu" :class="contentClass" :align="align" :side-offset="4" @click.stop @close-auto-focus="onCloseAutoFocus">
        <MenuItems :items="items" />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
