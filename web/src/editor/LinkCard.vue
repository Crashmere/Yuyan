<script setup lang="ts">
import { computed } from 'vue'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { ClipboardCopy, ExternalLink, PencilLine, Unlink } from 'lucide-vue-next'
import { base } from '../shared/api'
import { copyText } from '../shared/clipboard'
import { toast } from '../ui/toast'
import { useEditorContext } from './context'
import { openHref } from './links'
import FloatingToolbar from './FloatingToolbar.vue'

// The link's own card, shown below the link when the cursor stands in it: open, edit, copy
// or remove it. (Creating or editing a link from selected text stays in the text toolbar.)
const props = defineProps<{ hidden: boolean }>()
const { editor, tick, ui } = useEditorContext()

const href = computed(() => {
  void tick.value
  return String(editor.value?.getAttributes('link').href ?? '')
})

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const focused = view.hasFocus() || element.contains(document.activeElement)
  return !props.hidden && focused && e.isEditable && e.state.selection.empty && e.isActive('link')
}

async function copy() {
  const full = href.value.startsWith('/') ? new URL(base.replace(/\/$/, '') + href.value, location.origin).href : href.value
  const ok = await copyText(full)
  toast(ok ? '链接已复制' : '复制失败', ok ? 'success' : 'error')
}

function unlink() {
  editor.value?.chain().focus().extendMarkRange('link').unsetLink().run()
}
</script>

<template>
  <FloatingToolbar name="linkCard" label="链接" :hidden="hidden" :should-show="shouldShow" placement="bottom-start" class="yy-link-card">
    <button type="button" class="yy-link-card-url" :data-tip="href" @mousedown.prevent @click="openHref(href)">
      <ExternalLink :size="14" /><span>{{ href }}</span>
    </button>
    <button type="button" class="yy-bubble-btn" data-tip="编辑链接" aria-label="编辑链接" @mousedown.prevent @click="ui.openLink()"><PencilLine :size="15" /></button>
    <button type="button" class="yy-bubble-btn" data-tip="复制链接" aria-label="复制链接" @mousedown.prevent @click="copy"><ClipboardCopy :size="15" /></button>
    <button type="button" class="yy-bubble-btn" data-tip="取消链接" aria-label="取消链接" @mousedown.prevent @click="unlink"><Unlink :size="15" /></button>
  </FloatingToolbar>
</template>
