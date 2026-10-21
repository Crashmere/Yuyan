<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { ChevronDown, Link } from 'lucide-vue-next'
import { clearFormatting, currentStyle, markButtons, textStyles } from './commands'
import { useEditorContext } from './context'
import { withKey } from './keys'
import { hasTextTools, textMarkActive } from './textSelection'
import { ImageSelection } from './imageSelection'
import RemoveSelectionButton from './RemoveSelectionButton.vue'
import SaveSnippetButton from './SaveSnippetButton.vue'
import { codeEditorIn } from '../code/editor'
import TextColorMenu from './TextColorMenu.vue'
import FormatIcon from './FormatIcon.vue'
import { formatPainterState } from './formatPainter'
import FloatingToolbar from './FloatingToolbar.vue'

// The one shared text toolbar, shown next to selected text wherever that text lives — body,
// table cells, columns, quotes and other containers. It carries only controls that act on
// text itself (paragraph/heading style, marks, link, text color, clear formatting), plus
// the generic selection actions (remove, save as snippet) at its far right. Tools that
// belong to a component — table, image, columns, highlight block, … — never go here; each
// component mounts its own FloatingToolbar at its own fixed position (see EditorPane), and
// both can be visible at once. Its style list lives inside the bubble, since a menu in a
// separate layer would take focus away from the editor and hide the bubble.
const props = defineProps<{ hidden: boolean }>()
const { editor, tick, ui } = useEditorContext()
const stylesOpen = ref(false)

const state = computed(() => {
  void tick.value
  const e = editor.value
  if (!e) return null
  return { empty: e.state.selection.empty, text: hasTextTools(e), style: currentStyle(e)?.label ?? '正文', marks: Object.fromEntries(markButtons.map((m) => [m.name, textMarkActive(e, m.name)])), link: textMarkActive(e, 'link') }
})

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const insideCode = !!document.activeElement?.closest('.ProseMirror .cm-content, .yy-code-dialog .cm-content')
  const focused = view.hasFocus() || insideCode || element.contains(document.activeElement)
  const selection = e.state.selection
  const image = selection instanceof NodeSelection && ['image', 'imageBoard'].includes(selection.node.type.name)
  // A caret in a table and a cell selection show only the table toolbar; pure image
  // selections show only the image toolbar. This one follows selected text/content.
  const show = !props.hidden && !formatPainterState(e.state) && focused && e.isEditable && !selection.empty && !(selection instanceof CellSelection) && !(selection instanceof ImageSelection) && !image
  if (!show) stylesOpen.value = false
  return show
}

function applyStyle(apply: (e: Editor) => void) {
  if (editor.value) apply(editor.value)
  stylesOpen.value = false
}

function anchor() {
  const e = editor.value
  const selection = e?.state.selection
  if (!e || !selection) return null
  if (selection.$from.parent.type.name === 'codeBlock' && selection.$from.sameParent(selection.$to)) {
    const dom = e.view.nodeDOM(selection.$from.before())
    const code = dom instanceof Element ? codeEditorIn(dom) : undefined
    if (code) return { contextElement: code.view.dom, getBoundingClientRect() {
      const a = code.view.coordsAtPos(selection.from - selection.$from.start()), b = code.view.coordsAtPos(selection.to - selection.$from.start())
      if (!a || !b) return code.view.dom.getBoundingClientRect()
      return new DOMRect(Math.min(a.left, b.left), Math.min(a.top, b.top), Math.max(1, Math.abs(a.right - b.left)), Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top))
    } }
  }
  return null
}
</script>

<template>
  <FloatingToolbar v-if="state" name="bubbleMenu" label="选中内容" :hidden="hidden" :should-show="shouldShow" :anchor="anchor" update-on-tick class="yy-selection-toolbar">
    <div v-if="state.text" class="yy-selection-text-tools" role="group" aria-label="文字格式">
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
        v-for="m in markButtons.filter(m => m.name !== 'highlight')"
        :key="m.name"
        type="button"
        class="yy-bubble-btn"
        :class="{ active: state.marks[m.name] }"
        :data-tip="withKey(m.label, m.shortcut)"
        :aria-label="m.label"
        @mousedown.prevent
        @click="editor && m.toggle(editor)"
      >
        <component :is="m.icon" :size="16" />
      </button>
      <span class="yy-bubble-sep"></span>
      <button type="button" class="yy-bubble-btn" :class="{ active: state.link }" data-tip="链接" aria-label="链接" @mousedown.prevent @click="ui.openLink()"><Link :size="16" /></button>
      <TextColorMenu compact />
      <button type="button" class="yy-bubble-btn" :data-tip="withKey('清除格式', 'Mod-\\')" aria-label="清除格式" @mousedown.prevent @click="editor && clearFormatting(editor)"><FormatIcon kind="clear" :size="16" /></button>
    </div>
    <div class="yy-selection-content-tools">
      <RemoveSelectionButton v-if="!state.empty" />
      <SaveSnippetButton v-if="!state.empty" />
    </div>
  </FloatingToolbar>
</template>
