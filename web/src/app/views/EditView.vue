<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { Check, CircleAlert, ClipboardCopy, CloudCheck, Ellipsis, History, LoaderCircle } from 'lucide-vue-next'
import { api, ApiError, errorMessage, type Doc } from '../../shared/api'
import EditorPane, { type SaveStatus } from '../../editor/EditorPane.vue'
import ActionMenu from '../../ui/ActionMenu.vue'
import { confirm } from '../../ui/dialog'
import IconButton from '../../ui/IconButton.vue'
import type { MenuEntry } from '../../ui/menu'
import { copyDocLink } from '../actions'
import { setTitle } from '../router'
import { editing, loading, loadTree, setNodeTitle, setPage } from '../store'
import NotFoundState from './NotFoundState.vue'
import { useModeShortcut } from '../modeShortcut'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const readingPosition = route.meta.readingPosition
const doc = shallowRef<Doc | null>(null)
const pane = ref<InstanceType<typeof EditorPane> | null>(null)
const missing = ref(false)
const failure = ref('')
const status = ref<SaveStatus>('loading')
const statusText = ref('')
const words = ref(0)

useModeShortcut('Escape', '连按两次 Esc 键保存并回到阅读模式', () => !!pane.value && status.value !== 'loading', () => {
  // Use the same route guard as 完成: wait for uploads and saves, then restore the reading position.
  void router.push(`/docs/${id}`)
})

const menu: MenuEntry[] = [
  { label: '历史版本', icon: History, run: () => void router.push(`/docs/${id}/history`) },
  { label: '复制链接', icon: ClipboardCopy, run: () => copyDocLink(id) },
]

onMounted(async () => {
  try {
    const d = await loading(api<Doc>(`docs/${id}`))
    if (d.kind === 'group') {
      await router.replace(`/docs/${id}`)
      return
    }
    doc.value = d
    setPage(d.bookId, d.id)
    setTitle(`编辑：${d.title}`)
    void loadTree(d.bookId)
    editing.value = { docId: d.id, setTitle: (t) => pane.value?.setTitle(t) }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) missing.value = true
    else failure.value = errorMessage(e)
  }
})

onBeforeUnmount(() => {
  if (editing.value?.docId === id) editing.value = null
})

function onStatus(s: SaveStatus, text: string) {
  status.value = s
  statusText.value = text
}

function onSaved(title: string) {
  if (!doc.value) return
  setNodeTitle(doc.value.bookId, id, title)
  setTitle(`编辑：${title}`)
}

// 取消 drops what this session changed, after asking when there is something to drop.
async function cancel() {
  const p = pane.value
  if (!p || !doc.value) return
  const ask = p.touched()
  if (ask && !(await confirm({ title: '放弃这次编辑？', message: '这次打开编辑后所做的修改都会丢弃，历史版本里也不会留下记录。', confirmText: '放弃修改', danger: true }))) return
  if (!(await p.discard())) return
  setNodeTitle(doc.value.bookId, id, doc.value.title)
  await router.push(`/docs/${id}`)
}

// Leaving saves first; only content that could not reach the server needs a decision.
onBeforeRouteLeave(async (to) => {
  if (pane.value && !(await pane.value.flush())) {
    const leave = await confirm({
      title: '还有修改没有保存到服务器',
      message: '内容已暂存在这个浏览器里，下次打开这篇文档时可以恢复。仍要离开吗？',
      confirmText: '离开',
      danger: true,
    })
    if (!leave) return false
  }
  if (to.name === 'doc' && Number(to.params.id) === id) to.meta.readingPosition = pane.value?.capturePosition()
  return true
})
</script>

<template>
  <Teleport defer to="#yy-topbar-actions">
    <template v-if="doc">
      <span class="yy-save-status" :class="status" :data-tip="statusText">
        <LoaderCircle v-if="status === 'saving' || status === 'loading'" :size="14" class="yy-spin" />
        <CircleAlert v-else-if="status === 'offline' || status === 'error' || status === 'conflict'" :size="14" />
        <CloudCheck v-else :size="14" />
        <span class="yy-save-text">{{ statusText }}</span>
        <span class="yy-save-words">{{ words.toLocaleString() }} 字</span>
      </span>
      <ActionMenu :items="menu"><IconButton label="更多操作"><Ellipsis :size="18" /></IconButton></ActionMenu>
      <button type="button" class="yy-btn" @click="cancel">取消</button>
      <button type="button" class="yy-btn primary" @click="router.push(`/docs/${id}`)"><Check :size="15" />完成</button>
    </template>
  </Teleport>
  <main v-if="missing" class="yy-page"><NotFoundState /></main>
  <main v-else-if="failure" class="yy-page"><p class="yy-page-error">加载失败：{{ failure }}</p></main>
  <main v-else-if="doc" class="yy-edit-page">
    <EditorPane ref="pane" :doc="doc" :reading-position="readingPosition" @status="onStatus" @words="(n) => (words = n)" @saved="onSaved" />
  </main>
</template>
