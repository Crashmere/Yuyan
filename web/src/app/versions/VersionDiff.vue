<script setup lang="ts">
import { h, ref, shallowRef, watch, type FunctionalComponent } from 'vue'
import { ArrowRight, UnfoldVertical } from 'lucide-vue-next'
import { api, errorMessage, type Doc, type DocMeta, type Version, type VersionInfo, type VersionMeta } from '../../shared/api'
import { loading } from '../store'
import { formatTime } from '../time'
import type { Comparison } from './compare'
import type { Part } from './diff'

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
const expanded = ref(new Set<number>())
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
    expanded.value = new Set()
    try {
      const r = await loading(load(against))
      if (mine === run) result.value = r
    } catch (e) {
      if (mine === run) failure.value = errorMessage(e)
    }
  },
  { immediate: true },
)

const signs = { same: '', removed: '−', added: '+' }

// A line or title with the changed words in <del> or <ins>.
const Marked: FunctionalComponent<{ parts: Part[]; tag: 'del' | 'ins' }> = ({ parts, tag }) =>
  parts.map((p) => (p.changed ? h(tag, p.text) : p.text))
</script>

<template>
  <p v-if="failure" class="yy-page-error">加载失败：{{ failure }}</p>
  <section v-else-if="result" class="yy-diff-view" aria-label="版本对比">
    <p class="yy-diff-summary">
      <span>{{ result.from }}</span>
      <ArrowRight :size="14" />
      <span>{{ result.to }}</span>
      <template v-if="result.changed">
        <span class="yy-diff-count added">新增 {{ result.added }} 行</span>
        <span class="yy-diff-count removed">删除 {{ result.removed }} 行</span>
      </template>
    </p>
    <p v-if="result.title" class="yy-diff-title">
      <span class="yy-diff-label">标题</span>
      <span><Marked :parts="result.title[0]" tag="del" /></span>
      <ArrowRight :size="14" />
      <span><Marked :parts="result.title[1]" tag="ins" /></span>
    </p>
    <p v-if="!result.changed" class="yy-diff-same">{{ result.title ? '正文没有变化。' : '两个版本的内容相同。' }}</p>
    <div v-else class="yy-diff">
      <template v-for="b in result.blocks" :key="b.start">
        <button v-if="b.kind === 'gap' && !expanded.has(b.start)" type="button" class="yy-diff-gap" @click="expanded.add(b.start)">
          <UnfoldVertical :size="14" />展开 {{ b.lines.length }} 行未修改的内容
        </button>
        <template v-else>
          <div v-for="(l, i) in b.lines" :key="b.start + i" class="yy-diff-line" :class="l.kind">
            <span class="yy-diff-sign">{{ signs[l.kind] }}</span>
            <span v-if="l.kind === 'same'" class="yy-diff-text">{{ l.text }}</span>
            <span v-else class="yy-diff-text"><Marked :parts="l.parts" :tag="l.kind === 'added' ? 'ins' : 'del'" /></span>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
