<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { History, RotateCcw } from 'lucide-vue-next'
import { api, ApiError, errorMessage, type VersionView } from '../../shared/api'
import { confirm } from '../../ui/dialog'
import { toast } from '../../ui/toast'
import DocContent from '../content/DocContent.vue'
import { setTitle } from '../router'
import { loading, loadTree, setPage } from '../store'
import { formatTime } from '../time'
import NotFoundState from './NotFoundState.vue'
import { reasons } from './versions'

const route = useRoute()
const router = useRouter()
const view = ref<VersionView | null>(null)
const missing = ref(false)
const failure = ref('')

onMounted(async () => {
  try {
    const v = await loading(api<VersionView>(`versions/${route.params.id}/view`))
    view.value = v
    setPage(v.doc.bookId, v.doc.id)
    setTitle(`版本预览：${v.version.title}`)
    void loadTree(v.doc.bookId)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) missing.value = true
    else failure.value = errorMessage(e)
  }
})

async function restore() {
  const v = view.value
  if (!v) return
  const ok = await confirm({ title: '恢复这个版本？', message: '当前内容会先保存为一个历史版本。', confirmText: '恢复' })
  if (!ok) return
  try {
    await api(`versions/${v.version.id}/restore`, { method: 'POST', json: { baseRevision: v.doc.revision } })
    toast('已恢复', 'success')
    await router.push(`/docs/${v.doc.id}`)
  } catch (e) {
    toast(`恢复失败：${errorMessage(e)}`, 'error')
  }
}
</script>

<template>
  <Teleport defer to="#yy-topbar-actions">
    <template v-if="view">
      <RouterLink :to="`/docs/${view.doc.id}/history`" class="yy-btn"><History :size="15" />全部版本</RouterLink>
      <button v-if="view.version.revision !== view.doc.revision" type="button" class="yy-btn primary" @click="restore"><RotateCcw :size="15" />恢复此版本</button>
    </template>
  </Teleport>
  <main v-if="missing" class="yy-page"><NotFoundState /></main>
  <main v-else-if="failure" class="yy-page"><p class="yy-page-error">加载失败：{{ failure }}</p></main>
  <main v-else-if="view" class="yy-doc-page">
    <article class="yy-article">
      <p class="yy-banner">这是 {{ formatTime(view.version.createdAt) }} 的版本（{{ reasons[view.version.reason] ?? view.version.reason }}），只能查看。</p>
      <h1 class="yy-doc-title">{{ view.version.title }}</h1>
      <DocContent :html="view.html" :math="view.hasMath" :mermaid="view.hasMermaid" :images="view.images" />
    </article>
  </main>
</template>
