<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { api, errorMessage, type Doc, type DocMeta, type Version, type VersionInfo, type VersionMeta } from '../../shared/api'
import { loading } from '../store'
import { formatTime } from '../time'
import type { Comparison } from './compare'
import DiffBody from './DiffBody.vue'

// Compares a version with the one before it (what the version changed) or with the current
// document (what has changed since).
const props = defineProps<{
  version: VersionInfo
  previous: VersionMeta | null
  doc: DocMeta
  against: 'previous' | 'current'
}>()

const result = shallowRef<(Comparison & { from: string; to: string }) | null>(null)
const failure = ref('')
let run = 0

async function load(against: 'previous' | 'current') {
  const version = (id: number) => api<Version>(`versions/${id}`)
  const previous = against === 'previous' ? props.previous : null
  const [{ compareVersions }, before, after] = await Promise.all([
    import('./compare'),
    version(previous?.id ?? props.version.id),
    previous ? version(props.version.id) : api<Doc>(`docs/${props.doc.id}`),
  ])
  const [from, to] = previous ? [`上一条快照 r${previous.revision}（${formatTime(previous.createdAt)}）`, `本条快照 r${props.version.revision}`] : [`本条快照 r${props.version.revision}`, `当前内容 r${after.revision}`]
  return { from, to, ...compareVersions(before, after) }
}

watch(
  () => props.against,
  async (against) => {
    const mine = ++run
    result.value = null
    failure.value = ''
    try {
      const r = await loading(load(against))
      if (mine === run) result.value = r
    } catch (e) {
      if (mine === run) failure.value = errorMessage(e)
    }
  },
  { immediate: true },
)
</script>

<template>
  <p v-if="failure" class="yy-page-error">加载失败：{{ failure }}</p>
  <DiffBody v-else-if="result" :result="result" />
</template>
