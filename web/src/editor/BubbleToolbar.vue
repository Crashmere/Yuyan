<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { ChevronDown, Link, RemoveFormatting } from 'lucide-vue-next'
import { clearFormatting, currentStyle, markButtons, textStyles } from './commands'
import { useEditorContext } from './context'
import { withKey } from './keys'

// The toolbar over selected text. Its style list lives inside the bubble, since a menu in a
// separate layer would take focus away from the editor and hide the bubble.
const props = defineProps<{ hidden: boolean }>()
const { editor, tick, ui } = useEditorContext()
const stylesOpen = ref(false)

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
  return { style: currentStyle(e)?.label ?? '正文', marks: Object.fromEntries(markButtons.map((m) => [m.name, e.isActive(m.name)])), link: e.isActive('link') }
})

function shouldShow({ editor: e, element, view, from, to }: { editor: Editor; element: HTMLElement; view: EditorView; from: number; to: number }) {
  const focused = view.hasFocus() || element.contains(document.activeElement)
  const show = !props.hidden && focused && from !== to && e.isEditable && !e.isActive('codeBlock') && !e.isActive('image') && !e.isActive('inlineMath') && !e.isActive('blockMath')
  if (!show) stylesOpen.value = false
  return show
}

function applyStyle(apply: (e: Editor) => void) {
  if (editor.value) apply(editor.value)
  stylesOpen.value = false
}
</script>

<template>
  <BubbleMenu v-if="editor && state" :editor="editor" :should-show="shouldShow" class="yy-bubble">
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
      :title="withKey(m.label, m.shortcut)"
      @mousedown.prevent
      @click="m.toggle(editor)"
    >
      <component :is="m.icon" :size="16" />
    </button>
    <span class="yy-bubble-sep"></span>
    <button type="button" class="yy-bubble-btn" :class="{ active: state.link }" title="链接" @mousedown.prevent @click="ui.openLink()"><Link :size="16" /></button>
    <button type="button" class="yy-bubble-btn" :title="withKey('清除格式', 'Mod-\\')" @mousedown.prevent @click="clearFormatting(editor)"><RemoveFormatting :size="16" /></button>
  </BubbleMenu>
</template>
