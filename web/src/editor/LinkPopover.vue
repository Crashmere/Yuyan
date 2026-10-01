<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEditorContext } from './context'
import { onOutside, place } from './floating'
import { normalizeHref } from './links'
import { selectionContent } from './selectionContent'
import { setSelectedTextMark } from './textSelection'
import DocLinkPicker from './DocLinkPicker.vue'
import type { LinkChoice } from '../shared/internalLinks'

// Adds or edits a link. With nothing selected it asks for the text as well and inserts a new link.
const props = defineProps<{ from: number; to: number; href: string; withText: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { editor } = useEditorContext()
const selected = editor.value ? selectionContent(editor.value.state) : null
const mixedSelection = editor.value && selected?.images.length && selected.text.length ? editor.value.state.selection.getBookmark() : null

const text = ref('')
const url = ref(props.href)
const internal = ref(false)
const query = ref('')
const picker = ref<InstanceType<typeof DocLinkPicker> | null>(null)

function chooseLink(choice: LinkChoice) {
  url.value = choice.href
  if (!text.value) text.value = choice.label
  apply()
}
const panel = ref<HTMLElement | null>(null)
const first = ref<HTMLInputElement | null>(null)
let unplace = () => {}
let unoutside = () => {}
let closed = false

function close(refocus = true) {
  if (closed) return
  closed = true
  if (refocus) editor.value?.commands.focus()
  emit('close')
}

function apply() {
  const e = editor.value
  if (!e) return close(false)
  const href = normalizeHref(url.value)
  if (props.withText) {
    if (href) {
      const label = text.value.trim() || href
      e.chain().focus().insertContentAt(props.from, { type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] }).run()
    }
  } else if (mixedSelection) {
    e.view.dispatch(e.state.tr.setSelection(mixedSelection.resolve(e.state.doc)))
    setSelectedTextMark(e, 'link', href ? { href } : null)
  } else if (href) {
    e.chain().focus().setTextSelection({ from: props.from, to: props.to }).extendMarkRange('link').setLink({ href }).run()
  } else {
    e.chain().focus().setTextSelection({ from: props.from, to: props.to }).extendMarkRange('link').unsetLink().run()
  }
  close(false)
}

function remove() {
  const e = editor.value
  if (e && mixedSelection) {
    e.view.dispatch(e.state.tr.setSelection(mixedSelection.resolve(e.state.doc)))
    setSelectedTextMark(e, 'link', null)
  } else e?.chain().focus().setTextSelection({ from: props.from, to: props.to }).extendMarkRange('link').unsetLink().run()
  close(false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (internal.value && picker.value?.onKeyDown(e)) { e.preventDefault(); e.stopPropagation(); return }
  if (e.key === 'Enter') {
    e.preventDefault()
    apply()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

onMounted(async () => {
  const e = editor.value
  if (!panel.value || !e) return
  unplace = place(panel.value, {
    rect: () => {
      const a = e.view.coordsAtPos(props.from)
      const b = e.view.coordsAtPos(Math.max(props.from, props.to))
      return new DOMRect(a.left, a.top, Math.max(1, b.right - a.left), a.bottom - a.top)
    },
    context: e.view.dom,
  })
  unoutside = onOutside(() => panel.value, () => close(false))
  await nextTick()
  first.value?.focus()
  first.value?.select()
})
onBeforeUnmount(() => {
  unplace()
  unoutside()
})
</script>

<template>
  <div ref="panel" class="yy-float yy-link-panel" role="dialog" aria-label="链接" @keydown="onKeydown">
    <div class="yy-link-tabs">
      <button type="button" :class="{ active: !internal }" @click="internal = false">网址</button>
      <button type="button" :class="{ active: internal }" @click="internal = true">文档与章节</button>
    </div>
    <template v-if="internal">
      <input v-model="query" class="yy-input" placeholder="搜索文档或章节" aria-label="搜索文档或章节" />
      <DocLinkPicker ref="picker" :query="query" :command="chooseLink" />
    </template>
    <template v-else>
    <label v-if="withText" class="yy-float-field">
      <span>文字</span>
      <input ref="first" v-model="text" class="yy-input" placeholder="显示的文字" />
    </label>
    <label class="yy-float-field">
      <span>链接</span>
      <input :ref="withText ? undefined : (el) => (first = el as HTMLInputElement)" v-model="url" class="yy-input" placeholder="粘贴或输入链接地址" />
    </label>
    <div class="yy-float-actions">
      <button v-if="href" type="button" class="yy-btn small danger-text" @mousedown.prevent @click="remove">移除链接</button>
      <span class="yy-spacer"></span>
      <button type="button" class="yy-btn small" @mousedown.prevent @click="close()">取消</button>
      <button type="button" class="yy-btn small primary" @mousedown.prevent @click="apply">确定</button>
    </div>
    </template>
  </div>
</template>
