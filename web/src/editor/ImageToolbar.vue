<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { autoUpdate } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@tiptap/pm/view'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { Download, ExternalLink, Replace, TextCursorInput } from 'lucide-vue-next'
import { assetURL } from '../shared/api'
import { toast } from '../ui/toast'
import { useEditorContext } from './context'
import { imageTypes } from './extensions'
import { fileName } from './images'
import { uploadFile } from './uploads'
import RemoveSelectionButton from './RemoveSelectionButton.vue'
import AlignmentMenu from './AlignmentMenu.vue'
import ImageFormatControls from './ImageFormatControls.vue'

// Shown while an image is selected: size, replace, download, open, alternative text, delete.
const { editor, tick } = useEditorContext()
const menu = ref<InstanceType<typeof BubbleMenu> | null>(null)
const menuVisible = ref(false)
const positionOptions = {
  placement: 'top' as const,
  offset: 8,
  onShow: () => { menuVisible.value = true },
  onHide: () => { menuVisible.value = false },
}
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
    altOpen.value = false
  },
)

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const sel = e.state.selection
  const focused = view.hasFocus() || element.contains(document.activeElement)
  return focused && e.isEditable && sel instanceof NodeSelection && sel.node.type.name === 'image'
}

function anchor() {
  const e = editor.value
  const sel = e?.state.selection
  const dom = sel instanceof NodeSelection && sel.node.type.name === 'image' ? e?.view.nodeDOM(sel.from) : null
  const img = dom instanceof HTMLElement ? dom.querySelector('[data-image-frame], img') : null
  return img ? { getBoundingClientRect: () => img.getBoundingClientRect(), contextElement: img } : null
}

// Corner drags update the node view before committing a size to the document. Follow its
// painted geometry, including Vue's alignment updates, only while the image menu is visible.
watch([menuVisible, () => image.value?.pos], ([visible], _, onCleanup) => {
  const e = editor.value
  const reference = anchor()
  const element = menu.value?.$el
  if (!visible || !e || !reference || !(element instanceof HTMLElement)) return
  onCleanup(autoUpdate(reference, element, () => {
    if (!e.isDestroyed) e.view.dispatch(e.state.tr.setMeta('imageMenu', 'updatePosition'))
  }, { animationFrame: true }))
}, { flush: 'post' })

function setAttrs(pos: number, attrs: Record<string, unknown>) {
  const e = editor.value
  const node = e?.state.doc.nodeAt(pos)
  if (!e || node?.type.name !== 'image') return
  const tr = e.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
  e.view.dispatch(closeHistory(tr.setSelection(NodeSelection.create(tr.doc, pos))))
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
    if (pos >= 0) setAttrs(pos, { src: asset.url, crop: null, sourceWidth: asset.width ?? null, sourceHeight: asset.height ?? null })
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
  <BubbleMenu v-if="editor" ref="menu" :editor="editor" plugin-key="imageMenu" :update-delay="0" :resize-delay="0" :should-show="shouldShow" :get-referenced-virtual-element="anchor" :options="positionOptions" class="yy-bubble yy-image-toolbar">
    <template v-if="!altOpen">
      <ImageFormatControls>
        <span class="yy-bubble-sep"></span>
        <AlignmentMenu />
      </ImageFormatControls>
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
