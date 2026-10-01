<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { AllSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { ChevronDown } from 'lucide-vue-next'
import { copyText } from '../../shared/clipboard'
import { codeIcons } from '../../shared/codeIcons'
import { mermaidError, renderMermaid } from '../../shared/mermaid'
import { setCollapsed } from '../codeBlocks'
import LanguagePicker from './LanguagePicker.vue'
import { CodeEditor } from '../../code/editor'
import { codeActions, expandCode, type CodeAction } from '../../code/actions'
import { codeKey } from '../../code/preferences'
import { searchState } from '../search'
import { formatLanguage } from '../../code/formatLanguage'
import { expandSelection } from '../expandSelection'

const props = defineProps(nodeViewProps)

const language = computed(() => String(props.node.attrs.language || ''))
const isMermaid = computed(() => language.value.toLowerCase() === 'mermaid')

function setLanguage(value: string) {
  props.updateAttributes({ language: value || null })
}

// Back into the code after choosing a language or naming the block.
function refocus() {
  code.value?.view.focus()
}

// The title bar, as in Yuque (schema/codeBlock.ts): a title, and an arrow that collapses the code.
const titled = computed(() => typeof props.node.attrs.title === 'string' && !props.node.attrs.titleHidden)
const collapsed = computed(() => titled.value && !!props.node.attrs.collapsed)
// v-model waits for the end of Chinese input composition, so partial pinyin never reaches the
// document.
const titleText = ref(String(props.node.attrs.title ?? ''))
const titleInput = ref<HTMLInputElement | null>(null)
const titleBar = ref<HTMLElement | null>(null)
const titleHeight = ref(40)
const titleObserver = new ResizeObserver(entries => { titleHeight.value = entries[0]?.borderBoxSize[0]?.blockSize ?? titleBar.value?.offsetHeight ?? 40 })
watch(titleBar, el => { titleObserver.disconnect(); if (el) titleObserver.observe(el) })
onBeforeUnmount(() => titleObserver.disconnect())
watch(
  () => props.node.attrs.title,
  (t) => {
    if ((t ?? '') !== titleText.value) titleText.value = t ?? ''
  },
)
watch(titleText, (t) => {
  if (typeof props.node.attrs.title === 'string' && t !== props.node.attrs.title) props.updateAttributes({ title: t })
})

function setTitleHidden(titleHidden: boolean) {
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  const tr = props.editor.state.tr.setNodeMarkup(pos, undefined, { ...props.node.attrs, title: titleText.value, titleHidden, collapsed: false })
  props.editor.view.dispatch(closeHistory(tr))
  props.editor.view.dispatch(closeHistory(props.editor.state.tr))
}

async function showTitle() {
  setTitleHidden(false)
  await nextTick()
  titleInput.value?.focus()
}

function hideTitle() {
  setTitleHidden(true)
}

function toggle() {
  closeExpanded?.()
  const pos = props.getPos()
  if (typeof pos === 'number') setCollapsed(props.editor, pos, !collapsed.value)
}

function titleEntered() {
  if (collapsed.value) titleInput.value?.blur()
  else refocus()
}

async function titleKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
  if (event.key !== 'Tab' && event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Enter') { titleEntered(); return }
  if (collapsed.value) props.updateAttributes({ collapsed: false })
  await nextTick()
  code.value?.setSelection(0, 0, true)
}

const codeHost = ref<HTMLElement | null>(null)
const actions = ref<HTMLElement | null>(null)
const code = shallowRef<CodeEditor>()
const wrapped = ref(false)
function toggleWrap() {
  code.value?.setWrapped(!wrapped.value)
}

function leaveCode(unit: 'line' | 'char', direction: -1 | 1) {
  const cm = code.value?.view, pos = props.getPos()
  if (!cm || typeof pos !== 'number' || !cm.state.selection.main.empty) return false
  const main = cm.state.selection.main
  const range = unit === 'line' ? cm.state.doc.lineAt(main.head) : main
  if (direction < 0 ? range.from > 0 : range.to < cm.state.doc.length) return false
  const target = pos + (direction < 0 ? 0 : props.node.nodeSize)
  props.editor.view.dispatch(props.editor.state.tr.setSelection(Selection.near(props.editor.state.doc.resolve(target), direction)).scrollIntoView())
  props.editor.view.focus()
  return true
}

let closeExpanded: (() => void) | undefined
let removeActions: (() => void) | undefined
async function action(action: CodeAction) {
  const cm = code.value
  if (!cm) return
  if (collapsed.value) { props.updateAttributes({ collapsed: false }); await nextTick() }
  if (action === 'expand') {
    if (closeExpanded) return
    props.editor.view.dispatch(props.editor.state.tr.setMeta('bubbleMenu', 'hide'))
    closeExpanded = expandCode(cm, titleText.value || language.value || '代码块', () => {
      closeExpanded = undefined
      if (!props.editor.isDestroyed) props.editor.view.dispatch(props.editor.state.tr.setMeta('bubbleMenu', 'hide'))
    }, codeHost.value?.closest('.yy-codeblock')?.querySelector<HTMLElement>('.yy-codeblock-title, .yy-codeblock-bar') ?? undefined)
  }
  else if (action === 'find') cm.find()
  else if (action === 'format') await cm.format()
  else if (action === 'fold') cm.foldAll()
  else if (action === 'unfold') cm.unfoldAll()
}
watch(actions, el => { removeActions?.(); removeActions = el ? codeActions(el, a => { void action(a) }, true, () => !!formatLanguage(language.value)) : undefined })

onMounted(() => {
  const pos = props.getPos()
  if (!codeHost.value || typeof pos !== 'number') return
  let index = 0
  props.editor.state.doc.descendants((node, at) => { if (at < pos && node.type.name === 'codeBlock') index++ })
  code.value = new CodeEditor(codeHost.value, {
    doc: props.node.textContent, language: language.value, key: codeKey(index),
    onPreferences: preferences => { wrapped.value = preferences.wrapped },
    onExpandSelection: () => {
      expandSelection(props.editor.view)
      const pos = props.getPos(), selection = props.editor.state.selection
      if (typeof pos === 'number' && (selection.from <= pos || selection.to >= pos + props.node.nodeSize)) {
        closeExpanded?.()
        props.editor.view.focus()
      }
    },
    onUpdate: update => {
      const start = props.getPos()
      if (typeof start !== 'number' || props.editor.isDestroyed || (!update.docChanged && !update.view.hasFocus)) return
      const main = update.state.selection.main
      const selection = props.editor.state.selection
      if (!update.docChanged && selection.anchor === start + 1 + main.anchor && selection.head === start + 1 + main.head) return
      const tr = props.editor.state.tr
      let offset = start + 1
      update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
        if (text.length) tr.replaceWith(offset + fromA, offset + toA, props.editor.schema.text(text.toString()))
        else tr.delete(offset + fromA, offset + toA)
        offset += (toB - fromB) - (toA - fromA)
      })
      tr.setSelection(TextSelection.create(tr.doc, start + 1 + main.anchor, start + 1 + main.head))
      const formatting = update.transactions.some(transaction => transaction.isUserEvent('input.format'))
      if (formatting) closeHistory(tr)
      props.editor.view.dispatch(tr)
      if (formatting) props.editor.view.dispatch(closeHistory(props.editor.state.tr))
    },
    keys: [
      { key: 'Mod-z', run: () => props.editor.commands.undo() },
      { key: 'Shift-Mod-z', run: () => props.editor.commands.redo() },
      { key: 'ArrowUp', run: () => leaveCode('line', -1) }, { key: 'ArrowDown', run: () => leaveCode('line', 1) },
      { key: 'ArrowLeft', run: () => leaveCode('char', -1) }, { key: 'ArrowRight', run: () => leaveCode('char', 1) },
      { key: 'Mod-Enter', run: () => { const done = props.editor.commands.exitCode(); if (done) props.editor.view.focus(); return done } },
      { key: 'Backspace', run: view => { if (view.state.doc.length) return false; const done = props.editor.commands.clearNodes(); if (done) props.editor.view.focus(); return done } },
      { key: 'Mod-a', run: view => {
        if (view.state.selection.main.from !== 0 || view.state.selection.main.to !== view.state.doc.length) return false
        const state = props.editor.state, { $from, from, to } = state.selection
        let selection: Selection = new AllSelection(state.doc)
        for (let d = $from.depth; d > 0; d--) {
          if (!['codeBlock', 'callout', 'tableCell', 'tableHeader', 'foldBlock', 'highlightBlock', 'column', 'columns'].includes($from.node(d).type.name)) continue
          if ($from.start(d) < from || $from.end(d) > to) { selection = TextSelection.between(state.doc.resolve($from.start(d)), state.doc.resolve($from.end(d))); break }
        }
        props.editor.view.dispatch(state.tr.setSelection(selection)); props.editor.view.focus(); return true
      } },
    ],
  })
  wrapped.value = code.value.preferences.wrapped
})
watch(() => props.node.textContent, text => code.value?.setText(text))
watch(language, value => { void code.value?.setLanguage(value) })
let disposed = false, syncing = false, highlightKey = ''
function syncSelection() {
  if (syncing) return
  syncing = true
  queueMicrotask(() => {
  syncing = false
  if (disposed || !code.value) return
  const selection = props.editor.state.selection
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  code.value.setText(props.node.textContent)
  if (selection.from > pos && selection.to < pos + props.node.nodeSize) code.value.setSelection(selection.anchor - pos - 1, selection.head - pos - 1)
  const search = searchState(props.editor.state)
  const matches = search.matches.flatMap((match, i) => match.from > pos && match.to < pos + props.node.nodeSize ? [{ from: match.from - pos - 1, to: match.to - pos - 1, current: i === search.current }] : [])
  const key = JSON.stringify(matches)
  if (key !== highlightKey) { highlightKey = key; code.value.highlight(matches); if (matches.some(m => m.current)) code.value.revealSelection() }
  })
}
props.editor.on('transaction', syncSelection)
onBeforeUnmount(() => { disposed = true; props.editor.off('transaction', syncSelection); closeExpanded?.(); removeActions?.(); code.value?.destroy() })

// The diagram previews beside the source; a syntax error keeps the last diagram that worked.
const preview = ref('')
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [isMermaid.value, props.node.textContent] as const,
  ([mermaid, source], _previous, onCleanup) => {
    let active = true
    onCleanup(() => { active = false; clearTimeout(timer) })
    clearTimeout(timer)
    if (!mermaid) return
    timer = setTimeout(async () => {
      if (!source.trim()) {
        preview.value = ''
        error.value = ''
        return
      }
      try {
        const svg = await renderMermaid(source)
        if (!active) return
        preview.value = svg
        error.value = ''
      } catch (e) {
        if (active) error.value = mermaidError(e)
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
  <node-view-wrapper class="yy-codeblock" :style="{ '--code-title-height': `${titleHeight}px` }" :class="{ 'is-mermaid': isMermaid, 'has-title': titled, 'is-collapsed': collapsed, 'is-wrapped': wrapped }">
    <div v-if="titled" ref="titleBar" class="yy-codeblock-title" contenteditable="false">
      <button type="button" class="yy-codeblock-toggle" :aria-label="collapsed ? '展开代码' : '收起代码'" :aria-expanded="!collapsed" :data-tip="collapsed ? '展开代码' : '收起代码'" @click="toggle">
        <ChevronDown :size="15" />
      </button>
      <input ref="titleInput" v-model="titleText" class="yy-codeblock-name" data-editor-tab placeholder="代码块标题" aria-label="代码块标题" @keydown="titleKey" />
      <LanguagePicker :value="language" @change="setLanguage" @done="refocus" />
      <button type="button" class="yy-codeblock-btn yy-code-wrap-btn" aria-label="自动换行" :aria-pressed="wrapped" :data-tip="wrapped ? '关闭自动换行' : '开启自动换行'" @mousedown.prevent @click="toggleWrap">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="codeIcons.wrap" /></svg><span>自动换行</span>
      </button>
      <button type="button" class="yy-codeblock-btn" :aria-label="copied ? '已复制' : '复制'" :data-tip="copied ? '已复制' : '复制代码'" @mousedown.prevent @click="copy">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="copied ? codeIcons.check : codeIcons.copy" /></svg><span>{{ copied ? '已复制' : '复制' }}</span>
      </button>
      <span ref="actions" class="yy-code-actions"></span>
    </div>
    <div v-else class="yy-codeblock-bar" contenteditable="false">
      <LanguagePicker :value="language" @change="setLanguage" @done="refocus" />
      <button type="button" class="yy-codeblock-btn yy-code-copy-icon" :aria-label="copied ? '已复制' : '复制'" :data-tip="copied ? '已复制' : '复制代码'" @mousedown.prevent @click="copy">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="copied ? codeIcons.check : codeIcons.copy" /></svg>
      </button>
      <span ref="actions" class="yy-code-actions"></span>
    </div>
    <button
      v-show="!collapsed"
      type="button"
      class="code-tab"
      :class="{ 'is-down': !titled }"
      contenteditable="false"
      :aria-label="titled ? '隐藏标题栏' : '显示标题栏'"
      :data-tip="titled ? '隐藏标题栏' : '显示标题栏'"
      @click="titled ? hideTitle() : showTitle()"
    ></button>
    <div v-show="!collapsed" class="yy-codeblock-body">
      <div ref="codeHost" contenteditable="false"></div>
      <div v-if="isMermaid" class="yy-mermaid-preview" contenteditable="false">
        <div v-if="preview" class="yy-mermaid-svg" :class="{ stale: !!error }" v-html="preview"></div>
        <p v-else-if="!error" class="yy-mermaid-empty">输入 Mermaid 代码后在这里预览</p>
        <p v-if="error" class="yy-mermaid-error">{{ error }}<template v-if="preview"> 上面是上一次成功的预览。</template></p>
      </div>
    </div>
  </node-view-wrapper>
</template>
