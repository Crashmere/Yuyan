<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ChevronDown, ChevronLeft, ChevronRight, Download, File, Folder, FileQuestion, LoaderCircle, X } from 'lucide-vue-next'
import { api, errorMessage, unassetURL } from '../../shared/api'
import { archiveTree, fileSize, type ArchiveNode, type AttachmentPreview, type PreviewAttachment } from './attachmentPreview'

const props = defineProps<{ attachment: PreviewAttachment }>()
const emit = defineEmits<{ close: [] }>()
const data = shallowRef<AttachmentPreview | null>(null), busy = ref(true), failure = ref(''), mediaFailed = ref(false)
const canvas = ref<HTMLCanvasElement | null>(null), body = ref<HTMLElement | null>(null)
const pageNumber = ref(1), pages = ref(0), rendering = ref(false), query = ref('')
const expanded = ref(new Set<string>())
const controller = new AbortController()
const contentURL = computed(() => `${props.attachment.src}/content?name=${encodeURIComponent(props.attachment.name)}`)
let pdf: Awaited<ReturnType<typeof import('./pdfPreview').loadPDF>> | undefined
let resize: ResizeObserver | undefined, resizeTimer: ReturnType<typeof setTimeout> | undefined, renderGeneration = 0

const tree = computed(() => archiveTree(data.value?.entries ?? []))
const rows = computed(() => {
  const rows: { node: ArchiveNode; depth: number }[] = []
  const term = query.value.trim().toLocaleLowerCase()
  // A search reveals matches with their full paths, without changing expanded folders.
  function visit(nodes: Map<string, ArchiveNode>, depth: number) {
    const sorted = [...nodes.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    for (const node of sorted) {
      if (!term || node.path.toLocaleLowerCase().includes(term)) rows.push({ node, depth: term ? 0 : depth })
      if (term || expanded.value.has(node.path)) visit(node.children, depth + 1)
    }
  }
  visit(tree.value, 0)
  return rows
})
function toggle(path: string) {
  const value = new Set(expanded.value)
  if (value.has(path)) value.delete(path); else value.add(path)
  expanded.value = value
}

async function renderPage() {
  if (!pdf || !canvas.value || !body.value || controller.signal.aborted) return
  const generation = ++renderGeneration
  rendering.value = true; failure.value = ''
  try { await pdf.render(canvas.value, pageNumber.value, Math.max(120, body.value.clientWidth - 40)) }
  catch (e) {
    if (!controller.signal.aborted && generation === renderGeneration && (e as Error).name !== 'RenderingCancelledException') failure.value = '这一页暂时无法显示，可重试或下载后查看。'
  }
  finally { if (generation === renderGeneration) rendering.value = false }
}
function turn(step: number) {
  pageNumber.value = Math.min(pages.value, Math.max(1, pageNumber.value + step))
  body.value?.scrollTo({ top: 0 }); void renderPage()
}
function keydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); emit('close'); return }
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target instanceof HTMLInputElement) return
  if (data.value?.kind === 'pdf' && pages.value && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); turn(event.key === 'ArrowLeft' ? -1 : 1)
  }
}
async function load() {
  busy.value = true; failure.value = ''
  try {
    const id = unassetURL(props.attachment.src).match(/^\/attachments\/([0-9a-f]{32})$/)?.[1]
    if (!id) throw new Error('附件地址无效')
    data.value = await api<AttachmentPreview>(`attachments/${id}/preview?name=${encodeURIComponent(props.attachment.name)}`, { signal: controller.signal })
    if (controller.signal.aborted) return
    if (data.value.kind === 'pdf') {
      const { loadPDF } = await import('./pdfPreview')
      if (controller.signal.aborted) return
      pdf = await loadPDF(contentURL.value, controller.signal)
      pages.value = pdf.pages
      await nextTick(); await renderPage()
    }
  } catch (e) {
    if (!controller.signal.aborted) failure.value = (e as Error).name === 'PasswordException' ? 'PDF 已加密，请下载后输入密码打开。' : data.value?.kind === 'pdf' ? 'PDF 无法预览，文件可能已损坏或格式不受支持。' : errorMessage(e)
  } finally { if (!controller.signal.aborted) busy.value = false }
}
onMounted(() => {
  void load()
  resize = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { if (pdf) void renderPage() }, 120)
  })
  if (body.value) resize.observe(body.value)
})
onBeforeUnmount(() => { controller.abort(); resize?.disconnect(); clearTimeout(resizeTimer) })
</script>

<template>
  <DialogRoot :open="true" @update:open="open => !open && emit('close')">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-file-preview" :aria-describedby="undefined" @keydown="keydown">
        <header class="yy-file-heading">
          <div class="yy-file-title"><DialogTitle>{{ attachment.name }}</DialogTitle><span>{{ attachment.size }}</span></div>
          <a class="yy-btn yy-file-download" :href="attachment.download" :download="attachment.name" aria-label="下载附件"><Download :size="16" /><span>下载</span></a>
          <button type="button" class="yy-icon-btn" aria-label="关闭预览" data-tip="关闭" @click="emit('close')"><X :size="20" /></button>
        </header>
        <div v-if="data?.kind === 'archive'" class="yy-archive-toolbar">
          <span>{{ data.entries?.length ?? 0 }} 项{{ data.truncated ? ' · 部分目录' : '' }}</span>
          <input v-model="query" class="yy-input" aria-label="搜索压缩包内文件" placeholder="搜索文件或目录" />
        </div>
        <div v-if="pages" class="yy-pdf-toolbar">
          <button type="button" class="yy-icon-btn" :disabled="pageNumber <= 1" aria-label="上一页" data-tip="上一页" @click="turn(-1)"><ChevronLeft :size="18" /></button>
          <span>{{ pageNumber }} / {{ pages }}</span>
          <button type="button" class="yy-icon-btn" :disabled="pageNumber >= pages" aria-label="下一页" data-tip="下一页" @click="turn(1)"><ChevronRight :size="18" /></button>
          <LoaderCircle v-if="rendering" :size="14" class="yy-file-spinner" />
        </div>
        <div ref="body" class="yy-file-body" :class="{ 'is-media': ['image', 'pdf', 'video', 'audio'].includes(data?.kind ?? '') }" :aria-busy="busy || rendering">
          <div v-if="busy" class="yy-file-status" role="status"><LoaderCircle :size="24" class="yy-file-spinner" /><span>正在加载预览…</span></div>
          <div v-else-if="failure || mediaFailed || data?.kind === 'unsupported'" class="yy-file-status" role="status">
            <FileQuestion :size="36" :stroke-width="1.25" /><p>{{ failure || (mediaFailed ? '浏览器无法预览此文件，可下载后打开。' : data?.message) }}</p>
            <button v-if="failure && !pages" type="button" class="yy-btn" @click="load">重试</button>
            <button v-else-if="failure && pages" type="button" class="yy-btn" @click="renderPage">重试</button>
          </div>
          <template v-if="data && !failure && !mediaFailed">
            <img v-if="data.kind === 'image'" class="yy-file-image" :src="contentURL" :alt="attachment.name" @error="mediaFailed = true" />
            <video v-else-if="data.kind === 'video'" :src="contentURL" controls playsinline preload="metadata" @error="mediaFailed = true"></video>
            <audio v-else-if="data.kind === 'audio'" :src="contentURL" controls preload="metadata" @error="mediaFailed = true"></audio>
            <template v-else-if="data.kind === 'text'">
              <p v-if="data.truncated" class="yy-file-notice">文件较大，预览显示前 1 MiB 内容。</p>
              <pre v-if="data.text" class="yy-file-text">{{ data.text }}</pre><p v-else class="yy-file-status">这是一个空文件</p>
            </template>
            <template v-else-if="data.kind === 'archive'">
              <p v-if="data.message" class="yy-file-notice">{{ data.message }}</p>
              <div class="yy-archive-list" aria-label="压缩包目录">
                <div v-for="{ node, depth } in rows" :key="node.path" class="yy-archive-row" :style="{ '--depth': Math.min(depth, 12) }">
                  <button v-if="node.dir" type="button" :aria-expanded="expanded.has(node.path)" @click="toggle(node.path)">
                    <ChevronDown v-if="expanded.has(node.path)" :size="14" /><ChevronRight v-else :size="14" /><Folder :size="17" /><span>{{ query.trim() ? node.path.slice(1) : node.name }}</span>
                  </button>
                  <div v-else class="yy-archive-file"><File :size="17" /><span>{{ query.trim() ? node.path.slice(1) : node.name }}</span><small>{{ fileSize(node.size) }}</small></div>
                </div>
              </div>
              <p v-if="!rows.length && !data.message" class="yy-file-status">{{ query.trim() ? '没有匹配的文件' : '压缩包内没有文件' }}</p>
            </template>
          </template>
          <canvas v-show="data?.kind === 'pdf' && !failure && !busy" ref="canvas" class="yy-file-pdf" :aria-label="`PDF 第 ${pageNumber} 页`"></canvas>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.yy-file-preview { top: 50%; transform: translate(-50%, -50%); width: min(1000px, calc(100vw - 48px)); max-width: none; height: min(850px, calc(100dvh - 72px)); max-height: none; padding: 0; display: flex; flex-direction: column; overflow: hidden; gap: 0; animation: yy-fade .15s ease-out; }
.yy-file-heading { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--yy-border); flex-shrink: 0; }
.yy-file-title { flex: 1; min-width: 0; }
.yy-file-title h2 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; }
.yy-file-title > span { color: var(--yy-text-3); font-size: 12px; }
.yy-file-download { text-decoration: none; flex-shrink: 0; }
.yy-file-body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.yy-file-body.is-media { background: var(--yy-bg-muted); padding: 20px; text-align: center; }
.yy-file-status { min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; color: var(--yy-text-3); font-size: 14px; text-align: center; }
.yy-file-status p { margin: 0; }
.yy-file-spinner { animation: yy-file-spin 1s linear infinite; flex-shrink: 0; }
@keyframes yy-file-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .yy-file-spinner { animation: none; } }
.yy-file-image { display: block; margin: auto; max-width: 100%; max-height: 100%; object-fit: contain; }
.yy-file-body video { display: block; width: 100%; max-height: 100%; margin: auto; }
.yy-file-body audio { width: min(100%, 480px); margin-top: 60px; }
.yy-file-text { margin: 0; padding: 20px 24px; font: 13px/1.75 var(--yy-font-mono, monospace); white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; color: var(--yy-text); text-align: left; }
.yy-file-notice { margin: 0; padding: 12px 20px; background: var(--yy-bg-muted); color: var(--yy-text-2); font-size: 13px; border-bottom: 1px solid var(--yy-border); }
.yy-archive-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--yy-border); color: var(--yy-text-3); font-size: 12px; }
.yy-archive-toolbar .yy-input { width: min(60%, 260px); }
.yy-archive-list { padding: 10px 12px; }
.yy-archive-row { padding-left: calc(var(--depth) * 18px); }
.yy-archive-row button, .yy-archive-file { box-sizing: border-box; width: 100%; min-height: 36px; display: flex; align-items: center; gap: 8px; padding: 7px 8px; text-align: left; border: 0; border-radius: 5px; background: none; font: 13px/1.5 var(--yy-font); color: var(--yy-text); }
.yy-archive-row button { cursor: pointer; }
.yy-archive-row button:hover { background: var(--yy-bg-muted); }
.yy-archive-row svg { flex-shrink: 0; color: var(--yy-text-3); }
.yy-archive-row span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.yy-archive-file { padding-left: 30px; }
.yy-archive-file small { color: var(--yy-text-3); font-size: 11px; flex-shrink: 0; }
.yy-pdf-toolbar { display: flex; align-items: center; justify-content: center; gap: 16px; height: 44px; flex-shrink: 0; border-bottom: 1px solid var(--yy-border); font-size: 13px; color: var(--yy-text-2); }
.yy-file-pdf { display: block; margin: auto; max-width: 100%; background: white; box-shadow: 0 1px 8px rgb(0 0 0 / 8%); }
@media (max-width: 600px) {
  .yy-file-preview { width: calc(100vw - 16px); height: calc(100dvh - 32px); border-radius: 10px; }
  .yy-file-heading { padding: 12px; gap: 8px; }
  .yy-file-download span { display: none; }
  .yy-file-text { padding: 16px; }
  .yy-archive-row { padding-left: calc(min(var(--depth), 6) * 12px); }
}
</style>
