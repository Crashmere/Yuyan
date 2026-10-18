<script lang="ts">
import { defineComponent, h, ref, useModel, watch, type PropType } from 'vue'
import { deferred } from '../shared/deferred'
import type { MenuEntry } from './menu'
import { slotChild } from './slotChild'

const impl = deferred(() => import('./ActionMenuImpl.vue'))

// A dropdown menu opened from the element in the default slot. Until the menu first opens only
// that element renders, with a trigger's attributes; opening puts reka-ui's menu (ActionMenuImpl)
// in place, which handles everything from then on (DESIGN 26.5). The menu replaces the element
// after the click, so the press and the release land on the same element; a key that opens it
// is passed on to reka-ui's trigger.
export default defineComponent({
  name: 'ActionMenu',
  props: {
    items: { type: Array as PropType<MenuEntry[]>, required: true },
    align: { type: String as PropType<'start' | 'center' | 'end'>, default: 'end' },
    // Menus used inside the editor set this to false, so closing them leaves focus with the editor.
    restoreFocus: { type: Boolean, default: true },
    contentClass: { type: String, default: undefined },
    open: { type: Boolean, default: false },
  },
  emits: { 'update:open': (_open: boolean) => true },
  setup(props, { slots }) {
    const open = useModel(props, 'open')
    const active = ref(false)
    const openKey = ref<string>()
    function activate(key?: string, target?: EventTarget | null) {
      impl.load().then(() => {
        if (key && document.activeElement !== target) return
        openKey.value = key
        active.value = true
        if (!key) open.value = true
      }, () => {})
    }
    watch(open, (value) => {
      if (value && !active.value) activate()
    })
    const trigger = {
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-state': 'closed',
      onPointerdown(e: PointerEvent) {
        if (e.button !== 0 || e.ctrlKey) return
        impl.load().catch(() => {})
      },
      // Keep editor focus without suppressing mousedown: the selection toolbar uses its
      // capture handler to stay mounted when the opened menu takes focus.
      onMousedown(e: MouseEvent) {
        if (e.button === 0 && !e.ctrlKey) e.preventDefault()
      },
      onClick(e: MouseEvent) {
        if (!e.ctrlKey) activate()
      },
      // The keys reka-ui's trigger opens on; preventing them also stops the button's own click.
      onKeydown(e: KeyboardEvent) {
        if (!['Enter', ' ', 'ArrowDown'].includes(e.key)) return
        e.preventDefault()
        activate(e.key, e.currentTarget)
      },
    }
    return () => {
      const Impl = active.value ? impl.module.value?.default : undefined
      if (!Impl) return slotChild(slots, trigger)
      return h(Impl, {
        items: props.items,
        align: props.align,
        restoreFocus: props.restoreFocus,
        contentClass: props.contentClass,
        openKey: openKey.value,
        open: open.value,
        'onUpdate:open': (value: boolean) => (open.value = value),
      }, slots)
    }
  },
})
</script>
