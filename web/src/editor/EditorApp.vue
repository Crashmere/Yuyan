<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'
import type { Editor as CoreEditor, JSONContent } from '@tiptap/core'
import { api, ApiError, base, pageURL, type Doc } from '../shared/api'
import { editorExtensions, insertImages, setCurrentEditor } from './extensions'
import { toast } from './toast'

const props = defineProps<{ docId: number; bookName: string }>()

type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'offline' | 'error' | 'conflict'
interface Draft {
  title: string
  content: JSONContent
  baseRevision: number
  savedAt: number
}

const editor = shallowRef<Editor | null>(null)
const title = ref('')
const revision = ref(0)
const serverRevision = ref(0)
const status = ref<Status>('loading')
const failure = ref('')
const draftOffer = ref<Draft | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const titleInput = ref<HTMLTextAreaElement | null>(null)
const words = ref(0)

const draftKey = `yuyan:draft:${props.docId}`
const readURL = pageURL(`docs/${props.docId}`)
const historyURL = pageURL(`docs/${props.docId}/history`)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 2000
let inFlight = false
let again = false
let loaded = false

const statusText = computed(() => ({
  loading: '加载中…',
  saved: '已保存',
  dirty: '有未保存的修改',
  saving: '保存中…',
  offline: '网络断开，恢复后自动保存',
  error: `保存失败：${failure.value}，稍后重试`,
  conflict: '文档已在别处修改',
})[status.value])

function writeDraft() {
  if (!editor.value) return
  const draft: Draft = { title: title.value, content: editor.value.getJSON(), baseRevision: revision.value, savedAt: Date.now() }
  try {
    localStorage.setItem(draftKey, JSON.stringify(draft))
  } catch {
    // storage full: the pending save is still retried from memory
  }
}

function readDraft(): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey) ?? 'null')
  } catch {
    return null
  }
}

function changed() {
  if (!loaded) return
  if (status.value !== 'conflict') status.value = 'dirty'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 1200)
}

async function save() {
  if (!editor.value || status.value === 'conflict') return
  if (inFlight) {
    again = true
    return
  }
  clearTimeout(retryTimer)
  inFlight = true
  status.value = 'saving'
  writeDraft()
  try {
    const res = await api<{ revision: number }>(`docs/${props.docId}`, {
      method: 'PUT',
      json: { title: title.value, content: editor.value.getJSON(), baseRevision: revision.value },
    })
    revision.value = res.revision
    retryDelay = 2000
    if (!again) {
      localStorage.removeItem(draftKey)
      status.value = 'saved'
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      status.value = 'conflict'
      serverRevision.value = e.revision ?? 0
    } else {
      status.value = e instanceof ApiError && e.status === 0 ? 'offline' : 'error'
      failure.value = e instanceof Error ? e.message : String(e)
      retryTimer = setTimeout(save, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 60000)
    }
  } finally {
    inFlight = false
    if (again && status.value !== 'conflict') {
      again = false
      save()
    }
  }
}

// Explicit user choice after a conflict: keep this tab's content on top of the newer revision.
function overwrite() {
  revision.value = serverRevision.value
  status.value = 'dirty'
  save()
}

function reloadLatest() {
  localStorage.removeItem(draftKey)
  window.location.reload()
}

function restoreDraft() {
  const d = draftOffer.value
  if (!d || !editor.value) return
  title.value = d.title
  editor.value.commands.setContent(d.content)
  draftOffer.value = null
  if (d.baseRevision !== revision.value) {
    status.value = 'conflict'
    serverRevision.value = revision.value
  } else {
    changed()
  }
}

function discardDraft() {
  localStorage.removeItem(draftKey)
  draftOffer.value = null
}

async function finish() {
  clearTimeout(saveTimer)
  if (status.value === 'dirty') await save()
  if (status.value === 'saved') window.location.href = readURL
}

function pickImage() {
  fileInput.value?.click()
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (editor.value && files.length) insertImages(editor.value, files)
}

function setLink() {
  const e = editor.value
  if (!e) return
  const previous = e.getAttributes('link').href ?? ''
  const href = window.prompt('链接地址（留空则移除链接）', previous)
  if (href === null) return
  if (!href.trim()) e.chain().focus().extendMarkRange('link').unsetLink().run()
  else e.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
}

function shouldShowBubble({ editor: e, from, to }: { editor: CoreEditor; from: number; to: number }) {
  if (from === to || !e.isEditable) return false
  if (e.isActive('codeBlock') || e.isActive('image') || e.isActive('inlineMath') || e.isActive('blockMath')) return false
  return true
}

function autosizeTitle() {
  const el = titleInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function beforeUnload(e: BeforeUnloadEvent) {
  if (['dirty', 'saving', 'offline', 'error', 'conflict'].includes(status.value)) {
    writeDraft()
    e.preventDefault()
  }
}

function pageHide() {
  navigator.sendBeacon(`${base}api/docs/${props.docId}/snapshot`)
}

watch(title, () => {
  changed()
  nextTick(autosizeTitle)
})

onMounted(async () => {
  const d = await api<Doc>(`docs/${props.docId}`)
  title.value = d.title
  revision.value = d.revision
  const e = new Editor({
    extensions: editorExtensions(pickImage),
    content: d.content,
    onUpdate: ({ editor: ed }) => {
      words.value = ed.storage.characterCount.characters()
      changed()
    },
  })
  editor.value = e
  setCurrentEditor(e)
  words.value = e.storage.characterCount.characters()
  const draft = readDraft()
  if (draft && (draft.title !== d.title || JSON.stringify(draft.content) !== JSON.stringify(d.content))) draftOffer.value = draft
  else if (draft) localStorage.removeItem(draftKey)
  await nextTick()
  loaded = true
  status.value = 'saved'
  autosizeTitle()
  if (!d.content.content?.some((n) => n.content?.length)) titleInput.value?.focus()
  else e.commands.focus('start')
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('pagehide', pageHide)
  window.addEventListener('online', save)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('pagehide', pageHide)
  window.removeEventListener('online', save)
  setCurrentEditor(null)
  editor.value?.destroy()
})
</script>

<template>
  <div class="yy-editor-page">
    <header class="yy-editor-bar">
      <a class="yy-back" :href="readURL">← {{ bookName }}</a>
      <span class="yy-status" :class="status">{{ statusText }}</span>
      <span class="yy-spacer"></span>
      <span class="yy-count">{{ words }} 字</span>
      <a class="button" :href="historyURL">历史</a>
      <button class="primary" type="button" @click="finish">完成</button>
    </header>

    <div v-if="draftOffer" class="yy-banner">
      发现 {{ new Date(draftOffer.savedAt).toLocaleString() }} 未保存到服务器的内容。
      <button type="button" @click="restoreDraft">恢复</button>
      <button type="button" @click="discardDraft">丢弃</button>
    </div>
    <div v-if="status === 'conflict'" class="yy-banner danger">
      这篇文档已在别的标签页或设备上修改，自动保存已暂停，你的内容仍在当前页面。
      <button type="button" @click="reloadLatest">载入最新版本（放弃这里的修改）</button>
      <button type="button" @click="overwrite">用这里的内容覆盖</button>
    </div>

    <main class="yy-editor-main">
      <textarea
        ref="titleInput"
        v-model="title"
        class="yy-title-input"
        rows="1"
        placeholder="请输入标题"
        @keydown.enter.prevent="editor?.commands.focus('start')"
      ></textarea>
      <editor-content v-if="editor" :editor="editor" class="yy-content" />
    </main>

    <bubble-menu v-if="editor" :editor="editor" :should-show="shouldShowBubble" class="yy-bubble">
      <button type="button" :class="{ active: editor.isActive('bold') }" title="粗体" @click="editor.chain().focus().toggleBold().run()"><b>B</b></button>
      <button type="button" :class="{ active: editor.isActive('italic') }" title="斜体" @click="editor.chain().focus().toggleItalic().run()"><i>I</i></button>
      <button type="button" :class="{ active: editor.isActive('strike') }" title="删除线" @click="editor.chain().focus().toggleStrike().run()"><s>S</s></button>
      <button type="button" :class="{ active: editor.isActive('code') }" title="行内代码" @click="editor.chain().focus().toggleCode().run()">&lt;/&gt;</button>
      <button type="button" :class="{ active: editor.isActive('highlight') }" title="高亮" @click="editor.chain().focus().toggleHighlight().run()">高亮</button>
      <button type="button" :class="{ active: editor.isActive('link') }" title="链接" @click="setLink">链接</button>
    </bubble-menu>

    <drag-handle v-if="editor" :editor="editor">
      <div class="yy-drag" title="拖动调整位置">⠿</div>
    </drag-handle>

    <div v-if="toast" class="yy-toast">{{ toast }}</div>
    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple hidden @change="onFilePicked" />
  </div>
</template>
