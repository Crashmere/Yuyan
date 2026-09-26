<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { prefs } from '../../app/prefs'
import { copyText } from '../../shared/clipboard'
import { renderMermaid } from '../../shared/mermaid'
import LanguagePicker from './LanguagePicker.vue'

const props = defineProps(nodeViewProps)

const language = computed(() => String(props.node.attrs.language || ''))
const isMermaid = computed(() => language.value.toLowerCase() === 'mermaid')

function setLanguage(value: string) {
  props.updateAttributes({ language: value || null })
}

// Back into the code after choosing a language.
function refocus() {
  const pos = props.getPos()
  if (typeof pos === 'number') props.editor.chain().focus().setTextSelection(pos + 1).run()
}

// Line numbers sit on a transparent copy of the code with the same width and wrapping, so each
// number lines up with its line even when long lines wrap.
const lines = computed(() => (prefs.codeLineNumbers ? props.node.textContent.split('\n') : []))
const pre = ref<HTMLElement | null>(null)
const scrollLeft = ref(0)

// The diagram previews beside the source; a syntax error keeps the last diagram that worked.
const preview = ref('')
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [isMermaid.value, props.node.textContent] as const,
  ([mermaid, source]) => {
    clearTimeout(timer)
    if (!mermaid) return
    timer = setTimeout(async () => {
      if (!source.trim()) {
        preview.value = ''
        error.value = ''
        return
      }
      try {
        preview.value = await renderMermaid(source)
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
  <node-view-wrapper class="yy-codeblock" :class="{ 'is-mermaid': isMermaid }">
    <div class="yy-codeblock-bar" contenteditable="false">
      <LanguagePicker :value="language" @change="setLanguage" @done="refocus" />
      <button type="button" class="yy-codeblock-btn" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
    </div>
    <div class="yy-codeblock-body">
      <!-- No whitespace inside <pre>: it would show up as blank lines. -->
      <pre ref="pre" :class="{ 'has-numbers': prefs.codeLineNumbers }" @scroll="scrollLeft = pre?.scrollLeft ?? 0"><div v-if="prefs.codeLineNumbers" class="yy-code-lines" contenteditable="false" aria-hidden="true" :style="{ transform: `translateX(${scrollLeft}px)` }"><div v-for="(line, i) in lines" :key="i" :data-n="i + 1">{{ line }}</div></div><node-view-content as="code" :class="language ? `language-${language}` : undefined" /></pre>
      <div v-if="isMermaid" class="yy-mermaid-preview" contenteditable="false">
        <div v-if="preview" class="yy-mermaid-svg" :class="{ stale: !!error }" v-html="preview"></div>
        <p v-else-if="!error" class="yy-mermaid-empty">输入 Mermaid 代码后在这里预览</p>
        <p v-if="error" class="yy-mermaid-error">语法有误：{{ error }}<template v-if="preview">。上面是上一次成功的预览。</template></p>
      </div>
    </div>
  </node-view-wrapper>
</template>
