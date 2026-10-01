<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { getMarkRange, type JSONContent } from '@tiptap/core'
import { Mapping } from '@tiptap/pm/transform'
import { TableOfContents, X } from 'lucide-vue-next'
import IconButton from '../ui/IconButton.vue'
import { api, ApiError, base, errorMessage, type Doc } from '../shared/api'
import { stopLoading } from '../shared/images'
import { toast } from '../ui/toast'
import { prefs } from '../app/prefs'
import type { ReadingPosition } from '../app/content/readingPosition'
import BubbleToolbar from './BubbleToolbar.vue'
import { editorKey, type EditorUi } from './context'
import EditorOutline from './EditorOutline.vue'
import EditorToolbar from './EditorToolbar.vue'
import { editorExtensions, imageTypes } from './extensions'
import { imageSizes } from './images'
import type { Anchor } from './floating'
import FindReplace from './FindReplace.vue'
import LinkCard from './LinkCard.vue'
import LinkPopover from './LinkPopover.vue'
import MathPopover from './MathPopover.vue'
import TableGrid from './TableGrid.vue'
import ImageToolbar from './ImageToolbar.vue'
import HighlightBlockToolbar from './HighlightBlockToolbar.vue'
import ImageToolsDialog from './ImageToolsDialog.vue'
import type { ImageEditMode } from './imageOperations'
import { selectionContent } from './selectionContent'
import { insertImages, pendingUploads } from './uploads'
import { captureEditingPosition, restoreReadingPosition } from './readingPosition'
import 'katex/dist/katex.min.css'
import '../styles/editor.css'

export type SaveStatus = 'loading' | 'saved' | 'dirty' | 'saving' | 'offline' | 'error' | 'conflict'

const props = defineProps<{ doc: Doc; readingPosition?: ReadingPosition }>()
const emit = defineEmits<{ status: [SaveStatus, string]; words: [number]; saved: [string] }>()

interface Draft {
  title: string
  content: JSONContent
  baseRevision: number
  savedAt: number
}

const editor = shallowRef<Editor | null>(null)
const tick = ref(0)
const title = ref(props.doc.title)
const revision = ref(props.doc.revision)
const serverRevision = ref(0)
const status = ref<SaveStatus>('loading')
const failure = ref('')
const draftOffer = ref<Draft | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const titleInput = ref<HTMLTextAreaElement | null>(null)
const outlineOpen = ref(false)

// Panels over the editor.
const linkEdit = ref<{ from: number; to: number; href: string; withText: boolean } | null>(null)
const mathTarget = ref<{ pos: number; fresh: boolean } | null>(null)
const findOpen = ref(false)
const find = ref<InstanceType<typeof FindReplace> | null>(null)
const tableGrid = shallowRef<Anchor | null>(null)
const imageEdit = ref<{ mode: ImageEditMode; positions: number[] } | null>(null)

const ui: EditorUi = {
  openImageTools(mode, positions) {
    const e = editor.value
    if (!e) return
    const selected = positions ?? selectionContent(e.state).images.map((t) => t.pos)
    if (selected.length) imageEdit.value = { mode, positions: selected }
  },
  pickImage: () => fileInput.value?.click(),
  openLink() {
    const e = editor.value
    if (!e || e.isActive('codeBlock')) return
    const { from, to, empty } = e.state.selection
    const href = String(e.getAttributes('link').href ?? '')
    if (empty && e.isActive('link')) {
      const range = getMarkRange(e.state.doc.resolve(from), e.schema.marks.link)
      linkEdit.value = { from: range?.from ?? from, to: range?.to ?? to, href, withText: false }
    } else {
      linkEdit.value = { from, to, href: e.isActive('link') ? href : '', withText: empty }
    }
  },
  openMath: (pos, fresh = false) => {
    mathTarget.value = { pos, fresh }
  },
  async openFind() {
    findOpen.value = true
    await nextTick()
    find.value?.focusFind()
  },
  openTableGrid(anchor) {
    const e = editor.value
    if (!e) return
    tableGrid.value = anchor instanceof HTMLElement ? anchor : { rect: () => anchor, context: e.view.dom }
  },
}

provide(editorKey, { editor, tick, ui })

function insertTable(rows: number, cols: number, withHeaderRow = true) {
  tableGrid.value = null
  editor.value?.chain().focus().insertTable({ rows, cols, withHeaderRow }).run()
}

const draftKey = `yuyan:draft:${props.doc.id}`
let saveTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 2000
let inFlight = false
let again = false
let loaded = false
let savedThisSession = false
let discarded = false
const positionMapping = new Mapping()

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
  if (!loaded || discarded) return
  if (inFlight) again = true
  if (status.value !== 'conflict') status.value = 'dirty'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 1200)
}

async function save() {
  if (!editor.value || status.value === 'conflict' || discarded) return
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

// flush saves pending changes now and reports whether everything reached the server. Images still
// uploading are waited for first, so they are part of what gets saved.
async function flush(): Promise<boolean> {
  if (discarded) return true
  while (editor.value && pendingUploads(editor.value) > 0) await new Promise((r) => setTimeout(r, 100))
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

// Whether anything was edited since the editor opened.
function touched(): boolean {
  return revision.value !== props.doc.revision || status.value !== 'saved' || (!!editor.value && pendingUploads(editor.value) > 0)
}

// Cancelling puts the document back as it was when the editor opened, and drops the versions saved
// since, so the session leaves nothing in the history (store.DiscardEdits). Nothing more is saved
// afterwards, and leaving records no version.
async function discard(): Promise<boolean> {
  discarded = true
  clearTimeout(saveTimer)
  clearTimeout(retryTimer)
  while (inFlight) await new Promise((r) => setTimeout(r, 50))
  savedThisSession = false
  localStorage.removeItem(draftKey)
  if (revision.value === props.doc.revision) return true
  const d = props.doc
  try {
    await api(`docs/${d.id}/discard`, {
      method: 'POST',
      json: { title: d.title, content: d.content, updatedAt: d.updatedAt, since: d.revision, baseRevision: revision.value },
    })
    return true
  } catch (e) {
    discarded = false
    toast(`取消失败：${errorMessage(e)}`, 'error')
    return false
  }
}

function capturePosition() {
  const e = editor.value
  if (!e) return
  return captureEditingPosition(e, discarded ? { doc: e.schema.nodeFromJSON(props.doc.content), mapping: positionMapping.invert() } : undefined)
}

// Normal navigation must finish recording the snapshot before the history page loads.
// pagehide still uses a beacon as a best-effort fallback when the browser closes.
async function finish(): Promise<boolean> {
  if (!(await flush())) return false
  if (!savedThisSession) return true
  try {
    const savedRevision = revision.value
    await api(`docs/${props.doc.id}/snapshot`, { method: 'POST' })
    if (revision.value !== savedRevision || status.value !== 'saved') return finish()
    savedThisSession = false
    return true
  } catch (e) {
    toast(`正文已保存，历史快照未完成：${errorMessage(e)}。请重试。`, 'error')
    return false
  }
}

defineExpose({ flush, finish, setTitle, touched, discard, capturePosition })

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

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (editor.value && files.length) insertImages(editor.value, files)
}

function autosizeTitle() {
  const el = titleInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function beforeUnload(e: BeforeUnloadEvent) {
  const uploading = !!editor.value && pendingUploads(editor.value) > 0
  if (uploading || ['dirty', 'saving', 'offline', 'error', 'conflict'].includes(status.value)) {
    writeDraft()
    e.preventDefault()
  }
}

// Leaving the editor after saving something, by navigation or by closing the tab, ends an editing
// session and records a version.
function snapshot() {
  if (savedThisSession) navigator.sendBeacon(`${base}api/docs/${props.doc.id}/snapshot`)
}

// Find also opens from the title field, where the editor's keymap is not active.
function pageKeys(e: KeyboardEvent) {
  if (outlineOpen.value && e.key === 'Escape' && !e.isComposing) {
    e.preventDefault(); outlineOpen.value = false; return
  }
  if (e.defaultPrevented || (e.target as Element)?.closest('.cm-editor, .yy-code-dialog')) return
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.isComposing) return
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault()
    void ui.openFind()
  }
}

watch(title, () => {
  changed()
  void nextTick(autosizeTitle)
})

onMounted(async () => {
  const d = props.doc
  const e = new Editor({
    extensions: editorExtensions(ui, String(d.id)),
    content: d.content,
    onUpdate: ({ editor: ed }) => {
      emit('words', ed.storage.characterCount.characters())
      changed()
    },
    onTransaction: ({ transaction, appendedTransactions }) => {
      tick.value++
      positionMapping.appendMapping(transaction.mapping)
      for (const appended of appendedTransactions) positionMapping.appendMapping(appended.mapping)
    },
    // Before the node views are created, so images have their space from the start.
    onBeforeCreate: ({ editor: ed }) => {
      Object.assign(imageSizes(ed), d.images)
    },
  })
  editor.value = e
  emit('words', e.storage.characterCount.characters())
  const draft = readDraft()
  if (draft && (draft.title !== d.title || JSON.stringify(draft.content) !== JSON.stringify(d.content))) draftOffer.value = draft
  else if (draft) localStorage.removeItem(draftKey)
  await nextTick()
  loaded = true
  status.value = 'saved'
  autosizeTitle()
  const focusStart = () => {
    if (!d.content.content?.some((n) => n.content?.length)) titleInput.value?.focus()
    else e.commands.focus('start')
  }
  if (props.readingPosition) {
    // EditorContent attaches the document and builds its Vue node views in another nextTick.
    // Wait until those nested updates have finished before measuring the restored block.
    requestAnimationFrame(() => {
      if (!e.isDestroyed && !restoreReadingPosition(e, props.readingPosition!)) focusStart()
    })
  } else focusStart()
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('pagehide', snapshot)
  window.addEventListener('online', save)
  window.addEventListener('keydown', pageKeys)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('pagehide', snapshot)
  window.removeEventListener('online', save)
  window.removeEventListener('keydown', pageKeys)
  clearTimeout(saveTimer)
  clearTimeout(retryTimer)
  snapshot()
  if (editor.value) stopLoading(editor.value.view.dom)
  editor.value?.destroy()
})
</script>

<template>
  <div class="yy-editor-pane">
    <EditorToolbar />
    <div v-if="draftOffer" class="yy-banner yy-editor-banner">
      发现 {{ new Date(draftOffer.savedAt).toLocaleString() }} 未保存到服务器的内容。
      <button type="button" class="yy-btn small" @click="restoreDraft">恢复</button>
      <button type="button" class="yy-btn small" @click="discardDraft">丢弃</button>
    </div>
    <div v-if="status === 'conflict'" class="yy-banner danger yy-editor-banner">
      这篇文档已在别的标签页或设备上修改，自动保存已暂停，你的内容仍在当前页面。
      <button type="button" class="yy-btn small" @click="reloadLatest">载入最新版本（放弃这里的修改）</button>
      <button type="button" class="yy-btn small" @click="overwrite">用这里的内容覆盖</button>
    </div>

    <div class="yy-editor-body">
      <div class="yy-editor-main">
        <textarea
          ref="titleInput"
          v-model="title"
          class="yy-title-input"
          rows="1"
          placeholder="请输入标题"
          @keydown.enter.prevent="!$event.isComposing && editor?.commands.focus('start')"
        ></textarea>
        <editor-content v-if="editor" :editor="editor" class="yy-content" />
      </div>
      <aside v-if="editor" class="yy-doc-aside yy-editor-outline" :class="{ 'is-peek': !prefs.editorOutline, 'outline-open': outlineOpen }" :role="outlineOpen ? 'dialog' : undefined" :aria-modal="outlineOpen || undefined" :aria-label="outlineOpen ? '大纲' : undefined">
        <IconButton class="yy-editor-outline-close" label="关闭大纲" @click="outlineOpen = false"><X :size="18" /></IconButton>
        <EditorOutline @navigate="outlineOpen = false" />
      </aside>
    </div>
    <button v-if="outlineOpen" type="button" class="yy-editor-outline-mask" aria-label="关闭大纲" @click="outlineOpen = false"></button>
    <Teleport defer to="#yy-topbar-actions">
      <IconButton class="yy-editor-outline-open" label="大纲" :active="outlineOpen" @click="outlineOpen = !outlineOpen"><TableOfContents :size="18" /></IconButton>
    </Teleport>

    <FindReplace v-if="findOpen" ref="find" @close="findOpen = false" />
    <BubbleToolbar :hidden="!!linkEdit || !!mathTarget || !!imageEdit" />
    <LinkCard :hidden="!!linkEdit || !!mathTarget" />
    <LinkPopover v-if="linkEdit" v-bind="linkEdit" @close="linkEdit = null" />
    <MathPopover v-if="mathTarget" :key="mathTarget.pos" :pos="mathTarget.pos" :fresh="mathTarget.fresh" @close="mathTarget = null" />
    <TableGrid v-if="tableGrid" :anchor="tableGrid" @pick="insertTable" @close="tableGrid = null" />
    <ImageToolbar />
    <HighlightBlockToolbar :hidden="!!linkEdit || !!mathTarget || !!imageEdit || !!tableGrid || findOpen" />
    <ImageToolsDialog v-if="imageEdit" v-bind="imageEdit" @close="imageEdit = null" />

    <input ref="fileInput" type="file" :accept="imageTypes.join(',')" multiple hidden @change="onFilePicked" />
  </div>
</template>
