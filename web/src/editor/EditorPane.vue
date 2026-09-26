<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'
import type { Editor as CoreEditor, JSONContent } from '@tiptap/core'
import { api, ApiError, base, type Doc } from '../shared/api'
import { prompt } from '../ui/dialog'
import { editorExtensions, insertImages, setCurrentEditor } from './extensions'
import 'katex/dist/katex.min.css'
import '../styles/editor.css'

export type SaveStatus = 'loading' | 'saved' | 'dirty' | 'saving' | 'offline' | 'error' | 'conflict'

const props = defineProps<{ doc: Doc }>()
const emit = defineEmits<{ status: [SaveStatus, string]; words: [number]; saved: [string] }>()

interface Draft {
  title: string
  content: JSONContent
  baseRevision: number
  savedAt: number
}

const editor = shallowRef<Editor | null>(null)
const title = ref(props.doc.title)
const revision = ref(props.doc.revision)
const serverRevision = ref(0)
const status = ref<SaveStatus>('loading')
const failure = ref('')
const draftOffer = ref<Draft | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const titleInput = ref<HTMLTextAreaElement | null>(null)

const draftKey = `yuyan:draft:${props.doc.id}`
let saveTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 2000
let inFlight = false
let again = false
let loaded = false
let savedThisSession = false

function statusText(): string {
  return {
    loading: '加载中…',
    saved: '已保存',
    dirty: '有未保存的修改',
    saving: '保存中…',
    offline: '网络断开，恢复后自动保存',
    error: `保存失败：${failure.value}，稍后重试`,
    conflict: '文档已在别处修改',
  }[status.value]
}

watch([status, failure], () => emit('status', status.value, statusText()), { immediate: true })

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
  const savedTitle = title.value
  try {
    const res = await api<{ revision: number }>(`docs/${props.doc.id}`, {
      method: 'PUT',
      json: { title: savedTitle, content: editor.value.getJSON(), baseRevision: revision.value },
    })
    revision.value = res.revision
    retryDelay = 2000
    savedThisSession = true
    emit('saved', savedTitle.trim() || '无标题文档')
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
      void save()
    }
  }
}

// flush saves pending changes now and reports whether everything reached the server.
async function flush(): Promise<boolean> {
  clearTimeout(saveTimer)
  for (let attempt = 0; attempt < 3; attempt++) {
    while (inFlight) await new Promise((r) => setTimeout(r, 50))
    if (status.value === 'saved' || status.value === 'loading') return true
    if (status.value === 'conflict') return false
    await save()
  }
  return status.value === 'saved'
}

function setTitle(value: string) {
  title.value = value
}

defineExpose({ flush, setTitle })

// Explicit user choice after a conflict: keep this tab's content on top of the newer revision.
function overwrite() {
  revision.value = serverRevision.value
  status.value = 'dirty'
  void save()
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

function pickImage() {
  fileInput.value?.click()
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (editor.value && files.length) void insertImages(editor.value, files)
}

async function setLink() {
  const e = editor.value
  if (!e) return
  const previous = e.getAttributes('link').href ?? ''
  const href = await prompt({ title: previous ? '编辑链接' : '添加链接', label: '链接地址（留空则移除链接）', value: previous, placeholder: 'https://', allowEmpty: true })
  if (href === null) return
  if (!href) e.chain().focus().extendMarkRange('link').unsetLink().run()
  else e.chain().focus().extendMarkRange('link').setLink({ href }).run()
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

// Leaving the editor after saving something, by navigation or by closing the tab, ends an editing
// session and records a version.
function snapshot() {
  if (savedThisSession) navigator.sendBeacon(`${base}api/docs/${props.doc.id}/snapshot`)
}

watch(title, () => {
  changed()
  void nextTick(autosizeTitle)
})

onMounted(async () => {
  const d = props.doc
  const e = new Editor({
    extensions: editorExtensions(pickImage),
    content: d.content,
    onUpdate: ({ editor: ed }) => {
      emit('words', ed.storage.characterCount.characters())
      changed()
    },
  })
  editor.value = e
  setCurrentEditor(e)
  emit('words', e.storage.characterCount.characters())
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
  window.addEventListener('pagehide', snapshot)
  window.addEventListener('online', save)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('pagehide', snapshot)
  window.removeEventListener('online', save)
  clearTimeout(saveTimer)
  clearTimeout(retryTimer)
  snapshot()
  setCurrentEditor(null)
  editor.value?.destroy()
})
</script>

<template>
  <div class="yy-editor-pane">
    <div v-if="draftOffer" class="yy-banner">
      发现 {{ new Date(draftOffer.savedAt).toLocaleString() }} 未保存到服务器的内容。
      <button type="button" class="yy-btn small" @click="restoreDraft">恢复</button>
      <button type="button" class="yy-btn small" @click="discardDraft">丢弃</button>
    </div>
    <div v-if="status === 'conflict'" class="yy-banner danger">
      这篇文档已在别的标签页或设备上修改，自动保存已暂停，你的内容仍在当前页面。
      <button type="button" class="yy-btn small" @click="reloadLatest">载入最新版本（放弃这里的修改）</button>
      <button type="button" class="yy-btn small" @click="overwrite">用这里的内容覆盖</button>
    </div>

    <div class="yy-editor-main">
      <textarea
        ref="titleInput"
        v-model="title"
        class="yy-title-input"
        rows="1"
        placeholder="请输入标题"
        @keydown.enter.prevent="editor?.commands.focus('start')"
      ></textarea>
      <editor-content v-if="editor" :editor="editor" class="yy-content" />
    </div>

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

    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple hidden @change="onFilePicked" />
  </div>
</template>
