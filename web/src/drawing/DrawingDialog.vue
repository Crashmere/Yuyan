<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { JSONContent } from '@tiptap/core'
import { api, errorMessage } from '../shared/api'
import { buildPackage, downloadScene, hydrateDrawing, mountEngine, type SceneDraft } from './engine'
import { drawingDraft } from './drafts'
import { drawingTemplates } from './templates'
import type { DrawingPackage } from './types'
import './style.css'

const props = defineProps<{ src?: string; draftKey: () => string; apply: (node: JSONContent) => void }>()
const emit = defineEmits<{ close: [] }>()
const host = ref<HTMLElement | null>(null), input = ref<HTMLInputElement | null>(null)
const busy = ref(false), loading = ref(true), message = ref(''), draftWarning = ref('')
const template = ref('blank'), recovered = shallowRef<SceneDraft | null>(null)
let engine: Awaited<ReturnType<typeof mountEngine>> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let alive = true, accepted = false, latest: SceneDraft | undefined
let draftWrites = Promise.resolve()
const draftKeys = new Set<string>()
const pageHide = () => persist()
onMounted(() => window.addEventListener('pagehide', pageHide))
onBeforeUnmount(() => window.removeEventListener('pagehide', pageHide))
function freezeKeys(event: KeyboardEvent) { if (busy.value) { event.preventDefault(); event.stopImmediatePropagation() } }

function changed(scene: SceneDraft) {
  latest = scene
  if (loading.value || busy.value || accepted) return
  clearTimeout(timer)
  timer = setTimeout(() => persist(), 700)
}
function persist() {
  if (!latest || accepted) return
  const frozen = structuredClone(latest)
  const key = props.draftKey(); draftKeys.add(key)
  draftWrites = draftWrites.then(() => drawingDraft(key, 'put', frozen)).catch(() => { draftWarning.value = '本机草稿保存失败，请在关闭前应用或下载画板。' })
}
async function clearDraft() {
  accepted = true; clearTimeout(timer)
  await draftWrites
  draftKeys.add(props.draftKey())
  await Promise.all([...draftKeys].map(key => drawingDraft(key, 'delete').catch(() => {})))
}
async function start(scene: SceneDraft) {
  engine?.destroy(); engine = undefined
  if (!alive || !host.value) return
  const mounted = await mountEngine(host.value, scene, changed)
  if (!alive) { mounted.destroy(); return }
  engine = mounted; loading.value = false
}
onMounted(async () => {
  try {
    recovered.value = await drawingDraft(props.draftKey(), 'get').catch(() => null)
    const pkg = props.src ? await api<DrawingPackage>(`drawings/${props.src.split('/').pop()}`) : undefined
    await start(await hydrateDrawing(pkg))
  } catch (e) { message.value = errorMessage(e); loading.value = false }
})
onBeforeUnmount(() => { alive = false; clearTimeout(timer); if (!accepted) persist(); engine?.destroy() })

async function restoreDraft() {
  if (!recovered.value) return
  loading.value = true
  try { await start(recovered.value); recovered.value = null }
  catch (e) { loading.value = false; message.value = errorMessage(e) }
}
async function chooseTemplate() {
  if (!engine || busy.value) return
  // The choice is explicit in the dialog; existing scene is retained in the
  // document until Apply, and can be recovered by cancelling the dialog.
  try { await engine.template(template.value) } catch (e) { message.value = errorMessage(e) }
}
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !engine) return
  try { await engine.importFile(file); message.value = '' } catch (e) { message.value = errorMessage(e) }
  ;(event.target as HTMLInputElement).value = ''
}
async function apply() {
  if (!engine || busy.value) return
  busy.value = true; message.value = ''; clearTimeout(timer)
  const frozen = engine.capture()
  try {
    const pkg = await buildPackage(frozen)
    const node = await api<JSONContent>('drawings', { method: 'POST', json: pkg })
    if (!alive) return
    props.apply(node)
    await clearDraft()
    emit('close')
  } catch (e) { message.value = errorMessage(e); busy.value = false; persist() }
}
async function cancel() { if (!busy.value) { await clearDraft(); emit('close') } }
async function download(format: 'excalidraw' | 'svg' | 'png') {
  if (!engine) return
  try { await downloadScene(engine.capture(), format) } catch (e) { message.value = errorMessage(e) }
}
</script>

<template>
  <DialogRoot :open="true">
    <DialogPortal>
      <DialogOverlay class="yy-overlay yy-drawing-overlay" />
      <DialogContent class="yy-drawing-dialog" :aria-describedby="undefined" @escape-key-down.prevent @interact-outside.prevent @open-auto-focus.prevent @close-auto-focus.prevent @keydown.capture="freezeKeys" @keydown.stop>
        <header class="yy-drawing-header">
          <DialogTitle>编辑画板</DialogTitle>
          <div class="yy-drawing-actions">
            <button class="yy-btn" :disabled="busy" @click="cancel">取消</button>
            <button class="yy-btn primary" :disabled="busy || loading || !engine" @click="apply">{{ busy ? '正在保存…' : '应用' }}</button>
          </div>
        </header>
        <div class="yy-drawing-tools">
          <select v-model="template" class="yy-input" aria-label="画板模板" :disabled="busy || loading"><option v-for="t in drawingTemplates" :key="t.id" :value="t.id">{{ t.name }}</option></select>
          <button class="yy-btn small" :disabled="busy || loading" @click="chooseTemplate">使用模板</button>
          <button class="yy-btn small" :disabled="busy || loading" @click="input?.click()">导入</button>
          <details class="yy-drawing-download"><summary>下载</summary><div><button class="yy-btn small" :disabled="loading || busy || !engine" @click="download('excalidraw')">可编辑文件</button><button class="yy-btn small" :disabled="loading || busy || !engine" @click="download('svg')">SVG</button><button class="yy-btn small" :disabled="loading || busy || !engine" @click="download('png')">PNG</button></div></details>
          <input ref="input" type="file" accept=".excalidraw,application/json" hidden @change="importFile" />
        </div>
        <div v-if="recovered" class="yy-drawing-notice">发现此版本的未应用草稿。<button class="yy-btn small" :disabled="loading || busy" @click="restoreDraft">恢复草稿</button><button class="yy-btn small" @click="recovered = null">暂不恢复</button></div>
        <p v-if="message || draftWarning" role="alert" class="yy-drawing-notice">{{ message || draftWarning }}</p>
        <div class="yy-drawing-stage" :class="{ 'is-busy': busy }"><div ref="host" class="yy-drawing-mount" /><div v-if="loading || busy" class="yy-drawing-wait">{{ busy ? '正在生成预览并保存…' : '正在加载画板…' }}</div></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
