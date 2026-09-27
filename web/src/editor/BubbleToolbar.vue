<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { ChevronDown, Link, RemoveFormatting } from 'lucide-vue-next'
import { clearFormatting, currentStyle, markButtons, textStyles } from './commands'
import { useEditorContext } from './context'
import { withKey } from './keys'
import { hasTextTools } from './textSelection'
import RemoveSelectionButton from './RemoveSelectionButton.vue'

// The toolbar over selected content. Its style list lives inside the bubble, since a menu in a
// separate layer would take focus away from the editor and hide the bubble.
const props = defineProps<{ hidden: boolean }>()
const { editor, tick, ui } = useEditorContext()
const stylesOpen = ref(false)
const options = {
  offset: () => editor.value?.state.selection instanceof CellSelection ? 40 : 8,
  flip: () => ({ padding: { top: (document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0) + 8, left: 8, right: 8, bottom: 8 } }),
  shift: { padding: 8 },
}

// A click inside the bubble makes the plugin ignore the next blur, so a panel opened from it
// has to hide the bubble explicitly.
watch(
  () => props.hidden,
  (hidden) => {
    const e = editor.value
    if (hidden && e) e.view.dispatch(e.state.tr.setMeta('bubbleMenu', 'hide'))
  },
)

const state = computed(() => {
  void tick.value
  const e = editor.value
  if (!e) return null
  return { text: hasTextTools(e), style: currentStyle(e)?.label ?? '正文', marks: Object.fromEntries(markButtons.map((m) => [m.name, e.isActive(m.name)])), link: e.isActive('link') }
})

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const focused = view.hasFocus() || element.contains(document.activeElement)
  const selection = e.state.selection
  const image = selection instanceof NodeSelection && selection.node.type.name === 'image'
  const show = !props.hidden && focused && e.isEditable && !selection.empty && !image
  if (!show) stylesOpen.value = false
  return show
}

function applyStyle(apply: (e: Editor) => void) {
  if (editor.value) apply(editor.value)
  stylesOpen.value = false
}

// Keep actions reachable for a column taller/wider than the viewport. Only the menu's anchor
// is clipped; the selection and the table's peripheral controls retain their real geometry.
function anchor() {
  const e = editor.value
  const selection = e?.state.selection
  if (!e || !(selection instanceof CellSelection)) return null
  const first = e.view.nodeDOM(selection.$anchorCell.pos)
  const last = e.view.nodeDOM(selection.$headCell.pos)
  if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return null
  return {
    contextElement: first,
    getBoundingClientRect() {
      const a = first.getBoundingClientRect(), b = last.getBoundingClientRect()
      const table = first.closest('table')!.getBoundingClientRect()
      const scroll = first.closest('.yy-table-scroll')!.getBoundingClientRect()
      const toolbar = document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0
      const height = document.querySelector<HTMLElement>('.yy-selection-toolbar')?.offsetHeight ?? 38
      const left = Math.max(Math.min(a.left, b.left), scroll.left, 8)
      const right = Math.min(Math.max(a.right, b.right), scroll.right, innerWidth - 8)
      const selectedTop = Math.min(a.top, b.top)
      // Above the first few rows, a menu anchored to the row would cross the column rail.
      // Place it above the table there; farther down it can follow the selected rows.
      const above = selectedTop - table.top < height + 80 ? table.top : selectedTop
      const floor = toolbar + height + 48
      // If the rail still fits but a menu above it does not, put the menu inside the table.
      // Reserving its height in the rail itself would make the rail disappear much too early.
      const top = above === table.top && above < floor && table.top > toolbar
        ? table.top + height + 48 : Math.max(above, floor)
      const bottom = Math.max(top, Math.min(Math.max(a.bottom, b.bottom), innerHeight - 8))
      return new DOMRect(left, top, Math.max(0, right - left), bottom - top)
    },
  }
}
</script>

<template>
  <BubbleMenu v-if="editor && state" :editor="editor" :should-show="shouldShow" :get-referenced-virtual-element="anchor" :options="options" class="yy-bubble yy-selection-toolbar">
    <template v-if="state.text">
      <div class="yy-bubble-styles">
        <button type="button" class="yy-bubble-select" @mousedown.prevent @click="stylesOpen = !stylesOpen">{{ state.style }}<ChevronDown :size="13" /></button>
        <div v-if="stylesOpen" class="yy-bubble-list">
          <button v-for="s in textStyles" :key="s.id" type="button" :class="{ active: s.label === state.style }" @mousedown.prevent @click="applyStyle(s.apply)">
            <component :is="s.icon" :size="15" />{{ s.label }}
          </button>
        </div>
      </div>
      <span class="yy-bubble-sep"></span>
      <button
        v-for="m in markButtons"
        :key="m.name"
        type="button"
        class="yy-bubble-btn"
        :class="{ active: state.marks[m.name] }"
        :data-tip="withKey(m.label, m.shortcut)"
        :aria-label="m.label"
        @mousedown.prevent
        @click="m.toggle(editor)"
      >
        <component :is="m.icon" :size="16" />
      </button>
      <span class="yy-bubble-sep"></span>
      <button type="button" class="yy-bubble-btn" :class="{ active: state.link }" data-tip="链接" aria-label="链接" @mousedown.prevent @click="ui.openLink()"><Link :size="16" /></button>
      <button type="button" class="yy-bubble-btn" :data-tip="withKey('清除格式', 'Mod-\\')" aria-label="清除格式" @mousedown.prevent @click="clearFormatting(editor)"><RemoveFormatting :size="16" /></button>
      <span class="yy-bubble-sep"></span>
    </template>
    <RemoveSelectionButton />
  </BubbleMenu>
</template>
