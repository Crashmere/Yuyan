<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api, ApiError, errorMessage, type DocMeta, type VersionInfo } from '../../shared/api'
import { confirm } from '../../ui/dialog'
import { toast } from '../../ui/toast'
import { setTitle } from '../router'
import { loading, loadTree, setPage } from '../store'
import { formatTime } from '../time'
import NotFoundState from './NotFoundState.vue'
import { reasons } from './versions'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const doc = ref<DocMeta | null>(null)
const versions = ref<VersionInfo[]>([])
const missing = ref(false)
const failure = ref('')

onMounted(async () => {
  try {
    const res = await loading(api<{ doc: DocMeta; versions: VersionInfo[] }>(`docs/${id}/versions`))
    doc.value = res.doc
    versions.value = res.versions
    setPage(res.doc.bookId, res.doc.id)
    setTitle(`历史版本：${res.doc.title}`)
    void loadTree(res.doc.bookId)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) missing.value = true
    else failure.value = errorMessage(e)
  }
})

async function restore(v: VersionInfo) {
  if (!doc.value) return
  const ok = await confirm({ title: '恢复这个版本？', message: `用 ${formatTime(v.createdAt)} 的内容替换当前内容。当前内容会先保存为一个历史版本。`, confirmText: '恢复' })
  if (!ok) return
  try {
    await api(`versions/${v.id}/restore`, { method: 'POST', json: { baseRevision: doc.value.revision } })
    toast('已恢复', 'success')
    await router.push(`/docs/${id}`)
  } catch (e) {
    toast(`恢复失败：${errorMessage(e)}`, 'error')
  }
}
</script>

<template>
  <main v-if="missing" class="yy-page"><NotFoundState /></main>
  <main v-else-if="failure" class="yy-page"><p class="yy-page-error">加载失败：{{ failure }}</p></main>
  <main v-else-if="doc" class="yy-page yy-narrow">
    <h1 class="yy-page-title">历史版本</h1>
    <p class="yy-page-sub">编辑时每 10 分钟和每次编辑结束时自动保存一个版本，可以预览、对比并恢复任一版本。</p>
    <ul class="yy-version-list">
      <li v-for="(v, i) in versions" :key="v.id">
        <RouterLink :to="`/versions/${v.id}`" class="yy-version-time">{{ formatTime(v.createdAt) }}</RouterLink>
        <span class="yy-tag">{{ reasons[v.reason] ?? v.reason }}</span>
        <span class="yy-version-title">{{ v.title }}</span>
        <RouterLink v-if="i < versions.length - 1" :to="`/versions/${v.id}?compare=previous`" class="yy-btn small" title="与上一版本对比">对比</RouterLink>
        <span v-if="v.revision === doc.revision" class="yy-version-current">当前版本</span>
        <button v-else type="button" class="yy-btn small" @click="restore(v)">恢复</button>
      </li>
    </ul>
  </main>
</template>
