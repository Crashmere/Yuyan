<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api, ApiError, errorMessage, type ChangeSummary, type DocMeta, type VersionInfo } from '../../shared/api'
import { confirm } from '../../ui/dialog'
import { toast } from '../../ui/toast'
import { setTitle } from '../router'
import { loading, loadTree, setPage } from '../store'
import { formatTime } from '../time'
import NotFoundState from './NotFoundState.vue'
import { reasons } from './versions'
import VersionSummary from '../versions/VersionSummary.vue'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const doc = ref<DocMeta | null>(null)
const versions = ref<VersionInfo[]>([])
const pending = ref<ChangeSummary | null>(null)
const missing = ref(false)
const failure = ref('')

onMounted(async () => {
  try {
    const res = await loading(api<{ doc: DocMeta; versions: VersionInfo[]; pending: ChangeSummary | null }>(`docs/${id}/versions`))
    doc.value = res.doc
    versions.value = res.versions
    pending.value = res.pending
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
  <main v-else-if="doc" class="yy-page yy-history-page">
    <h1 class="yy-page-title">历史版本</h1>
    <p class="yy-page-sub">快照保存的是当时修改后的完整内容。编辑中每隔 10 分钟保存一次，结束编辑时再保存；摘要和“本次改动”均以上一条快照为基准。</p>
    <section class="yy-history-current" aria-label="当前内容">
      <div class="yy-version-body">
        <div class="yy-version-meta"><strong>当前内容</strong><span>r{{ doc.revision }} · {{ formatTime(doc.updatedAt) }}</span></div>
        <template v-if="pending && versions[0]">
          <p>已自动保存，尚未生成快照。相对最近快照：</p>
          <VersionSummary :summary="pending" />
        </template>
        <p v-else>与最新快照内容一致。</p>
      </div>
      <div class="yy-version-actions">
        <RouterLink :to="`/docs/${id}`" class="yy-btn small">查看文档</RouterLink>
        <RouterLink v-if="pending && versions[0]" :to="`/versions/${versions[0].id}?compare=current`" class="yy-btn small">查看差异</RouterLink>
      </div>
    </section>
    <ul class="yy-version-list">
      <li v-for="(v, i) in versions" :key="v.id">
        <div class="yy-version-info">
          <RouterLink :to="`/versions/${v.id}`" class="yy-version-time">{{ formatTime(v.createdAt) }}</RouterLink>
          <span>r{{ v.revision }} · {{ reasons[v.reason] ?? v.reason }}</span>
          <span v-if="v.matchesCurrent" class="yy-version-current">与当前内容一致</span>
        </div>
        <div class="yy-version-body">
          <span class="yy-version-title">{{ v.title }}</span>
          <VersionSummary :summary="v.summary" />
        </div>
        <div class="yy-version-actions">
          <RouterLink :to="`/versions/${v.id}`" class="yy-btn small">预览快照</RouterLink>
          <RouterLink v-if="i < versions.length - 1" :to="`/versions/${v.id}?compare=previous`" class="yy-btn small" data-tip="上一条快照 → 本条快照">本次改动</RouterLink>
          <button v-if="!v.matchesCurrent" type="button" class="yy-btn small" @click="restore(v)">恢复</button>
        </div>
      </li>
    </ul>
  </main>
</template>
