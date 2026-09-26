<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { renderMermaid } from '../../shared/mermaid'
import { copyText } from '../../shared/clipboard'

const props = defineProps(nodeViewProps)

const common = ['', 'bash', 'c', 'cpp', 'css', 'diff', 'go', 'html', 'ini', 'java', 'javascript', 'json', 'kotlin',
  'markdown', 'mermaid', 'nginx', 'php', 'properties', 'python', 'ruby', 'rust', 'sql', 'swift', 'typescript', 'xml', 'yaml']

const language = computed({
  get: () => String(props.node.attrs.language || ''),
  set: (v: string) => props.updateAttributes({ language: v || null }),
})
const languages = computed(() => (common.includes(language.value) ? common : [...common, language.value]))

const preview = ref('')
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

watch(
  () => [language.value, props.node.textContent] as const,
  ([lang, source]) => {
    clearTimeout(timer)
    if (lang !== 'mermaid') return
    timer = setTimeout(async () => {
      try {
        preview.value = source.trim() ? await renderMermaid(source) : ''
        error.value = ''
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    }, 400)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))

const copied = ref(false)
async function copy() {
  copied.value = await copyText(props.node.textContent)
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <node-view-wrapper class="yy-codeblock">
    <div class="yy-codeblock-bar" contenteditable="false">
      <select v-model="language" aria-label="代码语言">
        <option v-for="l in languages" :key="l" :value="l">{{ l || '纯文本' }}</option>
      </select>
      <button type="button" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
    </div>
    <pre><node-view-content as="code" :class="language ? `language-${language}` : undefined" /></pre>
    <div v-if="language === 'mermaid'" class="yy-mermaid-preview" contenteditable="false">
      <p v-if="error" class="yy-mermaid-error">图表语法有误：{{ error }}</p>
      <div v-else v-html="preview"></div>
    </div>
  </node-view-wrapper>
</template>
