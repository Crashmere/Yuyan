<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@tiptap/pm/view'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { ChevronDown, Download, ExternalLink, Replace, Square, TextCursorInput } from 'lucide-vue-next'
import { assetURL } from '../shared/api'
import { toast } from '../ui/toast'
import { useEditorContext } from './context'
import { imageTypes } from './extensions'
import { blockWidth, fileName } from './images'
import { uploadFile } from './uploads'
import RemoveSelectionButton from './RemoveSelectionButton.vue'
import AlignmentMenu from './AlignmentMenu.vue'

// Shown while an image is selected: size, replace, download, open, alternative text, delete.
const { editor, tick } = useEditorContext()
const sizesOpen = ref(false)
const altOpen = ref(false)
const alt = ref('')
const altInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const replacing = ref<number | null>(null)

const image = computed(() => {
  void tick.value
  const sel = editor.value?.state.selection
  return sel instanceof NodeSelection && sel.node.type.name === 'image' ? { pos: sel.from, attrs: sel.node.attrs } : null
})

watch(
  () => image.value?.pos,
  () => {
    sizesOpen.value = false
    altOpen.value = false
  },
)

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const sel = e.state.selection
  const focused = view.hasFocus() || element.contains(document.activeElement)
  return focused && e.isEditable && sel instanceof NodeSelection && sel.node.type.name === 'image'
}

function anchor() {
  const pos = image.value?.pos
  const dom = pos === undefined ? null : editor.value?.view.nodeDOM(pos)
  const img = dom instanceof HTMLElement ? dom.querySelector('img') : null
  return img ? { getBoundingClientRect: () => img.getBoundingClientRect(), contextElement: img } : null
}

function setAttrs(pos: number, attrs: Record<string, unknown>) {
  const e = editor.value
  const node = e?.state.doc.nodeAt(pos)
  if (!e || node?.type.name !== 'image') return
  const tr = e.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
  e.view.dispatch(closeHistory(tr.setSelection(NodeSelection.create(tr.doc, pos))))
}

const sizes = [
  { label: '原始尺寸', fraction: 0 },
  { label: '适应宽度', fraction: 1 },
  { label: '75%', fraction: 0.75 },
  { label: '50%', fraction: 0.5 },
  { label: '25%', fraction: 0.25 },
]

function resize(fraction: number) {
  const e = editor.value
  const img = image.value
  sizesOpen.value = false
  if (!e || !img) return
  if (!fraction) return setAttrs(img.pos, { width: null, height: null })
  const dom = e.view.nodeDOM(img.pos)
  if (!(dom instanceof HTMLElement)) return
  setAttrs(img.pos, { width: Math.round(blockWidth(dom) * fraction), height: null })
}

async function replace(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const img = image.value
  if (!file || !img) return
  const oldSrc = img.attrs.src as string
  replacing.value = 0
  try {
    const asset = await uploadFile(file, (f) => (replacing.value = Math.round(f * 100))).promise
    // Find the image again: the document may have changed during the upload.
    const e = editor.value
    if (!e) return
    let pos = e.state.doc.nodeAt(img.pos)?.attrs.src === oldSrc ? img.pos : -1
    if (pos < 0) {
      e.state.doc.descendants((n, p) => {
        if (pos < 0 && n.type.name === 'image' && n.attrs.src === oldSrc) pos = p
        return pos < 0
      })
    }
    if (pos >= 0) setAttrs(pos, { src: asset.url })
  } catch (err) {
    toast(`替换失败：${err instanceof Error ? err.message : err}`, 'error')
  } finally {
    replacing.value = null
  }
}

function download() {
  const src = image.value?.attrs.src as string | undefined
  if (!src) return
  const a = document.createElement('a')
  a.href = assetURL(src)
  a.download = fileName(src)
  a.click()
}

function open() {
  const src = image.value?.attrs.src as string | undefined
  if (src) window.open(assetURL(src), '_blank', 'noopener')
}

async function editAlt() {
  alt.value = String(image.value?.attrs.alt ?? '')
  altOpen.value = true
  await nextTick()
  altInput.value?.focus()
}

function saveAlt() {
  const img = image.value
  altOpen.value = false
  if (img) setAttrs(img.pos, { alt: alt.value.trim() || null })
  editor.value?.commands.focus()
}

function cancelAlt() {
  altOpen.value = false
  editor.value?.commands.focus()
}
</script>

<template>
  <BubbleMenu v-if="editor" :editor="editor" plugin-key="imageMenu" :should-show="shouldShow" :get-referenced-virtual-element="anchor" :options="{ placement: 'top', offset: 8 }" class="yy-bubble yy-image-toolbar">
    <template v-if="!altOpen">
      <div class="yy-bubble-styles">
        <button type="button" class="yy-bubble-select" @mousedown.prevent @click="sizesOpen = !sizesOpen">
          {{ image?.attrs.width ? `${image.attrs.width} px` : '原始尺寸' }}<ChevronDown :size="13" />
        </button>
        <div v-if="sizesOpen" class="yy-bubble-list">
          <button v-for="s in sizes" :key="s.label" type="button" @mousedown.prevent @click="resize(s.fraction)">{{ s.label }}</button>
        </div>
      </div>
      <span class="yy-bubble-sep"></span>
      <AlignmentMenu />
      <button type="button" class="yy-bubble-btn" :class="{ active: image?.attrs.shadow === true }" :aria-pressed="image?.attrs.shadow === true" :data-tip="image?.attrs.shadow ? '关闭阴影边框' : '显示阴影边框'" aria-label="阴影边框" @mousedown.prevent @click="image && setAttrs(image.pos, { shadow: image.attrs.shadow ? null : true })"><Square :size="16" /></button>
      <span class="yy-bubble-sep"></span>
      <button type="button" class="yy-bubble-btn" :data-tip="replacing === null ? '替换图片' : `上传中 ${replacing}%`" aria-label="替换图片" :disabled="replacing !== null" @mousedown.prevent @click="fileInput?.click()">
        <Replace :size="16" />
      </button>
      <button type="button" class="yy-bubble-btn" data-tip="下载" aria-label="下载" @mousedown.prevent @click="download"><Download :size="16" /></button>
      <button type="button" class="yy-bubble-btn" data-tip="查看原图" aria-label="查看原图" @mousedown.prevent @click="open"><ExternalLink :size="16" /></button>
      <button type="button" class="yy-bubble-btn" data-tip="替代文字" aria-label="替代文字" @mousedown.prevent @click="editAlt"><TextCursorInput :size="16" /></button>
      <span v-if="replacing !== null" class="yy-bubble-note">上传中 {{ replacing }}%</span>
      <span class="yy-bubble-sep"></span>
      <RemoveSelectionButton />
    </template>
    <form v-else class="yy-image-alt" @submit.prevent="saveAlt">
      <input ref="altInput" v-model="alt" class="yy-input" placeholder="图片无法显示时显示的文字" aria-label="替代文字" @keydown.esc.prevent="cancelAlt" />
      <button type="submit" class="yy-btn small primary">确定</button>
    </form>
    <input ref="fileInput" type="file" :accept="imageTypes.join(',')" hidden @change="replace" />
  </BubbleMenu>
</template>
