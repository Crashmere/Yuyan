<script lang="ts">
import { defineComponent, nextTick, onBeforeUnmount, ref, type PropType } from 'vue'
import { closeContextMenu, openContextMenu } from './contextMenu'
import type { MenuEntry } from './menu'
import { slotChild } from './slotChild'

// A right-click menu for the element in the default slot, with the same entries as ActionMenu. It
// opens at the pointer, or after a long press on a touch screen, in the menu the whole site shares
// (ContextMenuHost), so the element only listens (DESIGN 26.5). The timing follows reka-ui's
// context menu trigger.
const longPress = 700

export default defineComponent({
  name: 'ContextActions',
  props: {
    items: { type: Array as PropType<MenuEntry[]>, required: true },
    disabled: Boolean,
  },
  emits: { open: (_open: boolean) => true },
  setup(props, { slots, emit }) {
    const open = ref(false)
    const owner = {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancelPress = () => clearTimeout(timer)
    function show(x: number, y: number) {
      openContextMenu(owner, {
        x,
        y,
        items: () => props.items,
        onOpenChange: (value) => {
          open.value = value
          emit('open', value)
        },
      })
    }
    // Other handlers get a tick to prevent the menu, as with reka-ui.
    const listeners = {
      async onContextmenu(e: MouseEvent) {
        if (props.disabled) return
        await nextTick()
        if (e.defaultPrevented) return
        cancelPress()
        e.preventDefault()
        show(e.clientX, e.clientY)
      },
      async onPointerdown(e: PointerEvent) {
        if (props.disabled) return
        await nextTick()
        if (e.pointerType === 'mouse' || e.defaultPrevented) return
        cancelPress()
        timer = setTimeout(() => show(e.clientX, e.clientY), longPress)
      },
      onPointermove: cancelPress,
      onPointerup: cancelPress,
      onPointercancel: cancelPress,
    }
    onBeforeUnmount(() => {
      cancelPress()
      closeContextMenu(owner)
    })
    // iOS would otherwise show its own menu for a long press on a link.
    return () => slotChild(slots, { ...listeners, 'data-state': open.value ? 'open' : 'closed', style: { WebkitTouchCallout: 'none' } })
  },
})
</script>
