<script setup lang="ts">
import { h, ref, watch, type FunctionalComponent } from 'vue'
import { ArrowRight, UnfoldVertical } from 'lucide-vue-next'
import type { Comparison } from './compare'
import type { Part } from './diff'

// A comparison as changed lines between two labelled sides, with unchanged stretches folded.
const props = defineProps<{ result: Comparison & { from: string; to: string } }>()

const expanded = ref(new Set<number>())
watch(() => props.result, () => { expanded.value = new Set() })

const signs = { same: '', removed: '−', added: '+' }

// A line or title with the changed words in <del> or <ins>.
const Marked: FunctionalComponent<{ parts: Part[]; tag: 'del' | 'ins' }> = ({ parts, tag }) =>
  parts.map((p) => (p.changed ? h(tag, p.text) : p.text))
</script>

<template>
  <section class="yy-diff-view" aria-label="版本对比">
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
