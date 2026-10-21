<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { autoUpdate } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@tiptap/pm/view'
import { Captions, Download, ExternalLink, Replace, TextCursorInput } from 'lucide-vue-next'
import { assetURL } from '../shared/api'
import { toast } from '../ui/toast'
import { useEditorContext } from './context'
import { imageTypes } from './extensions'
import { fileName } from './images'
import { uploadFile } from './uploads'
import { selectionContent } from './selectionContent'
import { ImageSelection } from './imageSelection'
import FloatingToolbar from './FloatingToolbar.vue'
import RemoveSelectionButton from './RemoveSelectionButton.vue'
import SaveSnippetButton from './SaveSnippetButton.vue'
import AlignmentMenu from './AlignmentMenu.vue'
import ImageFormatControls from './ImageFormatControls.vue'
import ImageCaptionForm from './ImageCaptionForm.vue'

// The images' own floating toolbar, anchored to the (first) selected image: size, shadow,
// crop/split, batch parameters, grouping and alignment, plus — for a single directly
// selected image — replace, download, open, alternative text and caption. It covers single
// image selections, multi-image selections and images inside a mixed text selection; in
// the last case the shared text toolbar separately carries the text tools and the generic
// selection actions, so they are not repeated here.
const props = defineProps<{ hidden?: boolean }>()
const { editor, tick } = useEditorContext()
const shell = ref<InstanceType<typeof FloatingToolbar> | null>(null)
const menuVisible = ref(false)
const altOpen = ref(false)
const captionOpen = ref(false)
const alt = ref('')
const altInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const replacing = ref<number | null>(null)

const images = computed(() => {
  void tick.value
  return editor.value ? selectionContent(editor.value.state).images : []
})
const single = computed(() => {
  void tick.value
  const sel = editor.value?.state.selection
  return sel instanceof NodeSelection && sel.node.type.name === 'image' ? { pos: sel.from, attrs: sel.node.attrs } : null
})
// 'single': one image selected as a node; 'images': a pure multi-image selection;
// 'mixed': images inside a text selection (the text toolbar is showing alongside).
const mode = computed<'single' | 'images' | 'mixed' | null>(() => {
  if (!images.value.length) return null
  if (single.value) return 'single'
  return editor.value?.state.selection instanceof ImageSelection ? 'images' : 'mixed'
})

watch(
  () => single.value?.pos,
  () => {
    altOpen.value = false
    captionOpen.value = false
  },
)

function shouldShow({ editor: e, element, view }: { editor: Editor; element: HTMLElement; view: EditorView }) {
  const sel = e.state.selection
  const focused = view.hasFocus() || element.contains(document.activeElement)
  const board = sel instanceof NodeSelection && sel.node.type.name === 'imageBoard'
  return !props.hidden && focused && e.isEditable && !board && selectionContent(e.state).images.length > 0
}

function imageElement(pos: number) {
  const dom = editor.value?.view.nodeDOM(pos)
  return dom instanceof HTMLElement ? dom.querySelector('[data-image-frame], img') : null
}

function anchor() {
  const e = editor.value
  const sel = e?.state.selection
  if (!e || !sel || !images.value.length) return null
  const pos = single.value?.pos ?? (sel instanceof ImageSelection ? sel.head : images.value[0].pos)
  const img = imageElement(pos)
  return img ? { getBoundingClientRect: () => img.getBoundingClientRect(), contextElement: img } : null
}

// Corner drags update the node view before committing a size to the document. Follow its
// painted geometry, including Vue's alignment updates, only while the image menu is visible.
watch([menuVisible, () => single.value?.pos ?? images.value[0]?.pos], ([visible], _, onCleanup) => {
  const e = editor.value
  const reference = anchor()
  const element = shell.value?.element()
  if (!visible || !e || !reference || !element) return
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
  e.view.dispatch(closeHistory(e.state.tr))
}

async function replace(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const img = single.value
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
  const src = single.value?.attrs.src as string | undefined
  if (!src) return
  const a = document.createElement('a')
  a.href = assetURL(src)
  a.download = fileName(src)
  a.click()
}

function open() {
  const src = single.value?.attrs.src as string | undefined
  if (src) window.open(assetURL(src), '_blank', 'noopener')
}

async function editAlt() {
  alt.value = String(single.value?.attrs.alt ?? '')
  altOpen.value = true
  await nextTick()
  altInput.value?.focus()
}

function saveAlt() {
  const img = single.value
  altOpen.value = false
  if (img) setAttrs(img.pos, { alt: alt.value.trim() || null })
  editor.value?.commands.focus()
}

function cancelAlt() {
  altOpen.value = false
  editor.value?.commands.focus()
}
function saveCaption(value: string | null) {
  const img = single.value
  captionOpen.value = false
  if (img) setAttrs(img.pos, { caption: value })
  editor.value?.commands.focus()
}
</script>

<template>
  <FloatingToolbar ref="shell" name="imageMenu" label="图片" :hidden="hidden" :should-show="shouldShow" :anchor="anchor" update-on-tick class="yy-image-toolbar" @show="menuVisible = true" @hide="menuVisible = false">
    <template v-if="!altOpen && !captionOpen">
      <span v-if="mode && mode !== 'single'" class="yy-selected-image-count">{{ images.length }} 张图片</span>
      <ImageFormatControls>
        <template v-if="mode !== 'mixed'">
          <span class="yy-bubble-sep"></span>
          <AlignmentMenu />
        </template>
      </ImageFormatControls>
      <template v-if="mode === 'single'">
        <span class="yy-bubble-sep"></span>
        <button type="button" class="yy-bubble-btn" :data-tip="replacing === null ? '替换图片' : `上传中 ${replacing}%`" aria-label="替换图片" :disabled="replacing !== null" @mousedown.prevent @click="fileInput?.click()">
          <Replace :size="16" />
        </button>
        <button type="button" class="yy-bubble-btn" data-tip="下载" aria-label="下载" @mousedown.prevent @click="download"><Download :size="16" /></button>
        <button type="button" class="yy-bubble-btn" data-tip="查看原图" aria-label="查看原图" @mousedown.prevent @click="open"><ExternalLink :size="16" /></button>
        <button type="button" class="yy-bubble-btn" data-tip="替代文字" aria-label="替代文字" @mousedown.prevent @click="editAlt"><TextCursorInput :size="16" /></button>
        <button type="button" class="yy-bubble-btn" data-tip="图片说明" aria-label="图片说明" @mousedown.prevent @click="captionOpen = true"><Captions :size="16" /></button>
        <span v-if="replacing !== null" class="yy-bubble-note">上传中 {{ replacing }}%</span>
      </template>
      <template v-if="mode && mode !== 'mixed'">
        <span class="yy-bubble-sep"></span>
        <RemoveSelectionButton />
        <SaveSnippetButton v-if="mode === 'images'" />
      </template>
    </template>
    <ImageCaptionForm v-else-if="captionOpen" :value="single?.attrs.caption" @save="saveCaption" @cancel="captionOpen = false; editor?.commands.focus()" />
    <form v-else class="yy-image-alt" @submit.prevent="saveAlt">
      <input ref="altInput" v-model="alt" class="yy-input" placeholder="图片无法显示时显示的文字" aria-label="替代文字" @keydown.esc.prevent="cancelAlt" />
      <button type="submit" class="yy-btn small primary">确定</button>
    </form>
    <input ref="fileInput" type="file" :accept="imageTypes.join(',')" hidden @change="replace" />
  </FloatingToolbar>
</template>
