<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { PluginKey } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { useEditorContext } from './context'
import { toolbarMotion } from './toolbarMotion'

// Shared shell for every floating toolbar in the editor. A component toolbar declares only
// what is specific to it — when it shows (`shouldShow`), what it is anchored to (`anchor`),
// and its buttons (the default slot) — while this shell owns the BubbleMenu plumbing that
// used to be copied into each toolbar: plugin registration, motion, repositioning after Vue
// renders the buttons, hiding when a panel over the editor opens, and parenting inside an
// enlarged code view. To add a toolbar for a new component, mount a new FloatingToolbar in
// EditorPane with a unique `name`; never add component buttons to TextToolbar instead.
export interface FloatingAnchor {
  getBoundingClientRect: () => DOMRect
  contextElement?: Element
}
type ShouldShow = (args: { editor: Editor; element: HTMLElement; view: EditorView }) => boolean

const props = withDefaults(defineProps<{
  /** Unique BubbleMenu plugin name, e.g. 'bubbleMenu' for the shared text toolbar. */
  name: string
  label: string
  hidden?: boolean
  shouldShow: ShouldShow
  anchor?: () => FloatingAnchor | null
  offset?: number
  placement?: 'top' | 'bottom-start'
  /** Re-dispatch a position update after each selection/doc render (anchored toolbars). */
  updateOnTick?: boolean
}>(), { hidden: false, anchor: undefined, offset: 8, placement: undefined, updateOnTick: false })
const emit = defineEmits<{ show: []; hide: [] }>()

const { editor, tick } = useEditorContext()
const menu = ref<InstanceType<typeof BubbleMenu> | null>(null)
const pluginKey = new PluginKey(props.name)
const motion = toolbarMotion(() => menu.value?.$el)
const options = {
  ...motion,
  ...(props.placement ? { placement: props.placement } : {}),
  offset: props.offset,
  flip: () => ({ padding: { top: (document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0) + 8, left: 8, right: 8, bottom: 8 } }),
  shift: { padding: 8 },
  onShow: () => { motion.onShow(); emit('show') },
  onHide: () => { motion.onHide(); emit('hide') },
}

// The plugin positions before Vue renders the toolbar's buttons. Anchored toolbars update
// again after that render; comparing selection/doc identities keeps the positioning-only
// transaction from looping.
watch(
  [
    () => { void tick.value; return editor.value?.state.selection },
    () => { void tick.value; return editor.value?.state.doc },
  ],
  () => {
    if (!props.updateOnTick) return
    const e = editor.value
    if (e && !e.isDestroyed) e.view.dispatch(e.state.tr.setMeta(pluginKey, 'updatePosition'))
  },
  { flush: 'post' },
)

// A click inside the bubble makes the plugin ignore the next blur, so a panel opened from it
// has to hide the bubble explicitly.
watch(
  () => props.hidden,
  (hidden) => {
    const e = editor.value
    if (hidden && e) e.view.dispatch(e.state.tr.setMeta(pluginKey, 'hide'))
  },
)

function bubbleParent() {
  return document.querySelector<HTMLElement>('.yy-code-dialog') ?? editor.value!.view.dom.parentElement!
}

defineExpose({ element: () => (menu.value?.$el instanceof HTMLElement ? menu.value.$el : null) })
</script>

<template>
  <BubbleMenu v-if="editor" ref="menu" :plugin-key="pluginKey" :editor="editor" :update-delay="0" :should-show="shouldShow" :get-referenced-virtual-element="anchor" :append-to="bubbleParent" :options="options" class="yy-bubble" :aria-label="label" role="toolbar">
    <slot />
  </BubbleMenu>
</template>
