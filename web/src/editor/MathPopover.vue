<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import katex from 'katex'
import { needsDisplay } from '../shared/latex'
import { useEditorContext } from './context'
import { onOutside, place } from './floating'

// Edits the formula at pos with a live preview. A new, still empty formula is removed again when
// the panel is cancelled; an empty answer removes any formula.
const props = defineProps<{ pos: number; fresh: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { editor } = useEditorContext()

const start = editor.value?.state.doc.nodeAt(props.pos)
const block = start?.type.name === 'blockMath'
const latex = ref(String(start?.attrs.latex ?? ''))
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
let unplace = () => {}
let unoutside = () => {}
let closed = false

const preview = computed(() => {
  const value = latex.value.trim()
  if (!value) return { html: '', error: '' }
  try {
    return { html: katex.renderToString(value, { displayMode: block || needsDisplay(value), throwOnError: true, strict: 'ignore' }), error: '' }
  } catch (e) {
    return { html: '', error: (e as Error).message.replace(/^KaTeX parse error:\s*/, '') }
  }
})

function formula() {
  const n = editor.value?.state.doc.nodeAt(props.pos)
  return n && (n.type.name === 'inlineMath' || n.type.name === 'blockMath') ? n : null
}

function finish(action: 'apply' | 'cancel' | 'remove') {
  if (closed) return
  closed = true
  const e = editor.value
  const n = formula()
  if (e && n) {
    const value = latex.value.trim()
    const range = { from: props.pos, to: props.pos + n.nodeSize }
    if (action === 'remove' || (action === 'apply' && !value) || (action === 'cancel' && props.fresh && !String(n.attrs.latex).trim())) {
      e.chain().focus().deleteRange(range).run()
    } else if (action === 'apply' && value !== n.attrs.latex) {
      if (n.type.name === 'inlineMath') e.chain().focus().updateInlineMath({ latex: value, pos: props.pos }).run()
      else e.chain().focus().updateBlockMath({ latex: value, pos: props.pos }).run()
    } else {
      e.commands.focus()
    }
  }
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Escape') {
    e.preventDefault()
    finish('cancel')
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    finish('apply')
  }
}

onMounted(async () => {
  const e = editor.value
  if (!panel.value || !e) return
  unplace = place(panel.value, {
    rect: () => {
      const dom = e.view.nodeDOM(props.pos)
      if (dom instanceof HTMLElement) return dom.getBoundingClientRect()
      const c = e.view.coordsAtPos(Math.min(props.pos, e.state.doc.content.size))
      return new DOMRect(c.left, c.top, 1, c.bottom - c.top)
    },
    context: e.view.dom,
  })
  unoutside = onOutside(() => panel.value, () => finish('apply'))
  await nextTick()
  input.value?.focus()
  input.value?.select()
})
onBeforeUnmount(() => {
  unplace()
  unoutside()
})
</script>

<template>
  <div ref="panel" class="yy-float yy-math-panel" role="dialog" aria-label="编辑公式">
    <textarea
      ref="input"
      v-model="latex"
      class="yy-math-input"
      :rows="block ? 3 : 1"
      spellcheck="false"
      placeholder="输入 LaTeX，例如 E = mc^2"
      @keydown="onKeydown"
    ></textarea>
    <div class="yy-math-preview">
      <div v-if="preview.html" v-html="preview.html"></div>
      <p v-else-if="preview.error" class="yy-math-error">{{ preview.error }}</p>
      <p v-else class="yy-math-placeholder">实时预览</p>
    </div>
    <div class="yy-float-actions">
      <span class="yy-float-hint">Enter 确认 · Shift+Enter 换行 · Esc 取消</span>
      <button type="button" class="yy-btn small danger-text" @mousedown.prevent @click="finish('remove')">删除</button>
      <button type="button" class="yy-btn small primary" @mousedown.prevent @click="finish('apply')">确定</button>
    </div>
  </div>
</template>
