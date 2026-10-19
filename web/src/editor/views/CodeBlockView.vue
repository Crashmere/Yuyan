<script lang="ts">
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { SearchState } from '../search'

// CodeMirror mounts when a block comes within 1000px of the window, or when something needs its
// editor (code/editor.ts codeEditorIn). Until then the block shows its code as plain text in the
// same box (code/style.css).
type Waiting = { observer: IntersectionObserver; pending: WeakMap<Element, (entry: IntersectionObserverEntry) => void> }
const observers = new Map<string, Waiting>()
function whenWithin(margin: string, el: Element, run: (entry: IntersectionObserverEntry) => void) {
  let waiting = observers.get(margin)
  if (!waiting) {
    const pending = new WeakMap<Element, (entry: IntersectionObserverEntry) => void>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        const next = pending.get(entry.target)
        pending.delete(entry.target)
        next?.(entry)
      }
    }, { rootMargin: margin })
    observers.set(margin, waiting = { observer, pending })
  }
  const { observer, pending } = waiting
  pending.set(el, run)
  observer.observe(el)
  return () => { pending.delete(el); observer.unobserve(el) }
}

// Wrap and fold preferences belong to the n-th code block of the page (code/preferences.ts).
const indexes = new WeakMap<PMNode, Map<number, number>>()
function codeIndex(doc: PMNode, pos: number) {
  let found = indexes.get(doc)
  if (!found) {
    const map = new Map<number, number>()
    doc.descendants((node, at) => {
      if (node.type.name === 'codeBlock') map.set(at, map.size)
      return !node.isTextblock
    })
    indexes.set(doc, found = map)
  }
  return found.get(pos) ?? 0
}

// Found once for all blocks: the block holding the selection, and the one holding the current
// find match. The others skip each transaction without looking up their position.
const holders = new WeakMap<EditorState, Node | null>()
function holding(view: EditorView, state: EditorState) {
  let dom = holders.get(state)
  if (dom === undefined) {
    const { $from, $to } = state.selection
    dom = $from.parent.type.name === 'codeBlock' && $from.sameParent($to) ? view.nodeDOM($from.before()) : null
    holders.set(state, dom)
  }
  return dom
}
const matched = new WeakMap<SearchState, Node | null>()
function matching(view: EditorView, state: EditorState, search: SearchState) {
  let dom = matched.get(search)
  if (dom === undefined) {
    const match = search.matches[search.current], $at = match && state.doc.resolve(match.from)
    dom = $at?.parent.type.name === 'codeBlock' ? view.nodeDOM($at.before()) : null
    matched.set(search, dom)
  }
  return dom
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { ChevronDown } from 'lucide-vue-next'
import { copyText } from '../../shared/clipboard'
import { codeIcons } from '../../shared/codeIcons'
import { mermaidError, renderMermaid } from '../../shared/mermaid'
import { setCollapsed } from '../codeBlocks'
import LanguagePicker from './LanguagePicker.vue'
import { CodeEditor } from '../../code/editor'
import { codeActions, expandCode, type CodeAction } from '../../code/actions'
import { codeKey, readCodePreferences } from '../../code/preferences'
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
  mount()?.view.focus()
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
// Showing or hiding the title bar flips the `has-title` class, which changes `.cm-content`'s
// padding (editor.css reserves 38px for the floating bar only without a title). A CSS class change
// does not notify CodeMirror, so its gutter re-syncs with the new layout while the content lines
// stay at the old padding. Ask the mounted editor to re-measure once the class has updated.
watch(titled, () => {
  const view = code.value?.view
  if (view) void nextTick(() => view.requestMeasure())
})
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
  mount()?.setSelection(0, 0, true)
}

const codeHost = ref<HTMLElement | null>(null)
const placeholder = ref<HTMLElement | null>(null)
const actions = ref<HTMLElement | null>(null)
const code = shallowRef<CodeEditor>()
const wrapped = ref(false)
function toggleWrap() {
  mount()?.setWrapped(!wrapped.value)
}

// The plain text before CodeMirror mounts, line for line: a trailing newline still opens a line.
const staticText = computed(() => {
  const text = props.node.textContent
  return text === '' || text.endsWith('\n') ? `${text} ` : text
})
const staticNumbers = computed(() => Array.from({ length: props.node.textContent.split('\n').length }, (_, i) => i + 1).join('\n'))
function enterCode(event: MouseEvent) {
  const cm = mount()
  if (!cm) return
  event.preventDefault()
  const at = cm.view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
  cm.setSelection(at, at, true)
}
// A mouse press places the caret at once; a touch waits for the tap, as it may start a scroll.
function pressCode(event: PointerEvent) { if (event.button === 0 && event.pointerType === 'mouse') enterCode(event) }
function tapCode(event: MouseEvent) { if (event.button === 0 && !code.value) enterCode(event) }

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
  const cm = mount()
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

let preferenceKey = '', root: Element | null = null, stopWaiting: (() => void) | undefined
onMounted(() => {
  const pos = props.getPos()
  if (!codeHost.value || typeof pos !== 'number') return
  preferenceKey = codeKey(codeIndex(props.editor.state.doc, pos))
  wrapped.value = readCodePreferences(preferenceKey).wrapped
  root = codeHost.value.closest('.yy-codeblock')
  Object.assign(codeHost.value, { mountCode: mount })
  stopWaiting = whenWithin('1000px 0px', codeHost.value, entry => {
    const host = codeHost.value, cm = mount()
    if (!host || !cm) return
    // Out of view, CodeMirror guesses the height of lines it has not drawn. Hold the placeholder's
    // exact height until it has measured them, so long blocks do not shrink and grow back. The
    // expand dialog sets the host's inline min-height itself, so this hold goes through a variable.
    host.style.setProperty('--yy-code-held', `${entry.boundingClientRect.height}px`)
    stopWaiting = whenWithin('0px', host, () => cm.view.requestMeasure({ read: () => null, write: () => host.style.removeProperty('--yy-code-held') }))
  })
})
function mount() {
  if (code.value || disposed || !preferenceKey || !codeHost.value) return code.value
  stopWaiting?.()
  placeholder.value?.remove()
  code.value = new CodeEditor(codeHost.value, {
    doc: props.node.textContent, language: language.value, key: preferenceKey,
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
        closeExpanded?.()
        props.editor.commands.selectAll(); props.editor.view.focus(); return true
      } },
    ],
  })
  wrapped.value = code.value.preferences.wrapped
  syncSelection()
  return code.value
}
watch(() => props.node.textContent, text => code.value?.setText(text))
watch(language, value => { void code.value?.setLanguage(value) })
let disposed = false, syncing = false, highlightKey = '', synced: SearchState | undefined
function syncSelection() {
  if (syncing) return
  syncing = true
  queueMicrotask(() => {
  syncing = false
  if (disposed || !root) return
  const view = props.editor.view, state = props.editor.state, search = searchState(state)
  const own = holding(view, state) === root
  // Other blocks follow only new find results, and unmounted ones only the current match.
  if (!own && search === synced) return
  if (!own && !code.value && matching(view, state, search) !== root) return
  const cm = mount(), pos = props.getPos()
  if (!cm || typeof pos !== 'number') return
  synced = search
  cm.setText(props.node.textContent)
  if (own) cm.setSelection(state.selection.anchor - pos - 1, state.selection.head - pos - 1)
  const matches = search.matches.flatMap((match, i) => match.from > pos && match.to < pos + props.node.nodeSize ? [{ from: match.from - pos - 1, to: match.to - pos - 1, current: i === search.current }] : [])
  const key = JSON.stringify(matches)
  if (key !== highlightKey) { highlightKey = key; cm.highlight(matches); if (matches.some(m => m.current)) cm.revealSelection() }
  })
}
props.editor.on('transaction', syncSelection)
onBeforeUnmount(() => { disposed = true; stopWaiting?.(); props.editor.off('transaction', syncSelection); closeExpanded?.(); removeActions?.(); code.value?.destroy() })

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
      <div ref="codeHost" class="yy-code-editor-host" contenteditable="false">
        <div v-if="!code" ref="placeholder" class="yy-code-static" @pointerdown="pressCode" @click="tapCode">
          <div class="yy-code-static-numbers" aria-hidden="true">{{ staticNumbers }}</div>
          <div class="yy-code-static-text">{{ staticText }}</div>
        </div>
      </div>
      <div v-if="isMermaid" class="yy-mermaid-preview" contenteditable="false">
        <div v-if="preview" class="yy-mermaid-svg" :class="{ stale: !!error }" v-html="preview"></div>
        <p v-else-if="!error" class="yy-mermaid-empty">输入 Mermaid 代码后在这里预览</p>
        <p v-if="error" class="yy-mermaid-error">{{ error }}<template v-if="preview"> 上面是上一次成功的预览。</template></p>
      </div>
    </div>
  </node-view-wrapper>
</template>
