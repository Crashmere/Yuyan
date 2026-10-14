<script setup lang="ts">
import { nextTick, shallowRef, watch } from 'vue'
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import ContextMenuItems from './ContextMenuItems.vue'
import { closeContextMenu, contextMenu, type OpenContextMenu } from './contextMenu'
import { vHalfRow } from './halfRow'

// The right-click menu ContextActions opens. reka-ui's trigger opens its menu where a contextmenu
// event happened, so each request reaches an empty trigger as such an event at its position.
// Every request gets its own menu: reka-ui reports a pointer press or focus outside the previous
// one a little later, and that must not close the next request.
const shown = shallowRef<OpenContextMenu | null>(null)
let anchor: Element | null = null

function setAnchor(el: unknown) {
  anchor = el as Element | null
}

watch(contextMenu, async (request) => {
  if (!request) return
  await nextTick()
  if (contextMenu.value !== request) return
  anchor?.firstElementChild?.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true, clientX: request.x, clientY: request.y }))
}, { immediate: true, flush: 'post' })

function onOpenChange(request: OpenContextMenu, value: boolean) {
  if (contextMenu.value !== request) return
  shown.value = value ? request : null
  if (value) request.onOpenChange(true)
  else closeContextMenu(request.owner)
}
</script>

<template>
  <template v-for="request in contextMenu ? [contextMenu] : []" :key="request.id">
    <ContextMenuRoot :open="shown === request" :modal="false" @update:open="onOpenChange(request, $event)">
      <div :ref="setAnchor" class="yy-context-anchor"><ContextMenuTrigger /></div>
      <ContextMenuPortal>
        <ContextMenuContent v-half-row class="yy-menu">
          <ContextMenuItems :items="request.items()" />
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenuRoot>
  </template>
</template>
