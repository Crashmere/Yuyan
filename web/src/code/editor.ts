import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection, type DecorationSet, type KeyBinding, type ViewUpdate } from '@codemirror/view'
import { bracketMatching, codeFolding, foldAll, foldCode, foldedRanges, foldEffect, foldGutter, indentOnInput, indentUnit, syntaxHighlighting, unfoldAll, unfoldCode, unfoldEffect } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { standardKeymap, simplifySelection, deleteLine, indentLess, indentMore, moveLineDown, moveLineUp, copyLineDown, toggleComment, toggleBlockComment } from '@codemirror/commands'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { closeSearchPanel, search, searchPanelOpen, selectNextOccurrence } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { codeLanguage } from './language'
import { codeHash, readCodePreferences, saveCodePreferences, type CodePreferences } from './preferences'
import { codeSearchPanel, openCodeSearch } from './search'
import { formatLanguage } from './formatLanguage'
import { codeKeys } from './keymap'
import './style.css'

const externalMatches = StateEffect.define<{ from: number; to: number; current: boolean }[]>()
const externalHighlights = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(externalMatches)) value = Decoration.set(effect.value.map(m => Decoration.mark({ class: m.current ? 'yy-find-match current' : 'yy-find-match' }).range(m.from, m.to)), true)
    return value
  },
  provide: field => EditorView.decorations.from(field),
})

export interface CodeEditorOptions {
  doc: string
  language: string
  key: string
  readOnly?: boolean
  onUpdate?: (update: ViewUpdate) => void
  keys?: KeyBinding[]
  onPreferences?: (preferences: CodePreferences) => void
}

export class CodeEditor {
  readonly view: EditorView
  preferences: CodePreferences
  private language = new Compartment()
  private wrapping = new Compartment()
  private generation = 0
  private syncing = false
  private destroyed = false
  private stopDrag?: () => void
  private observer: MutationObserver
  private languageName = ''
  private version = 0
  private formatting = false
  private feedback?: HTMLElement
  private feedbackTimer?: ReturnType<typeof setTimeout>

  constructor(readonly host: HTMLElement, readonly options: CodeEditorOptions) {
    this.preferences = readCodePreferences(options.key)
    const lineSelection = (view: EditorView, line: { from: number }, event: Event) => {
      const e = event as MouseEvent
      if (e.button !== 0) return false
      e.preventDefault()
      const anchor = e.shiftKey ? view.state.doc.lineAt(view.state.selection.main.anchor).number : view.state.doc.lineAt(line.from).number
      const select = (number: number) => {
        const a = view.state.doc.line(anchor), b = view.state.doc.line(number)
        const from = Math.min(a.from, b.from), to = Math.min(view.state.doc.length, Math.max(a.to, b.to) + 1)
        view.dispatch({ selection: { anchor: number < anchor ? to : from, head: number < anchor ? from : to } })
        view.focus()
      }
      select(view.state.doc.lineAt(line.from).number)
      const move = (event: MouseEvent) => {
        const at = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 1, y: event.clientY }, false)
        if (at !== null) select(view.state.doc.lineAt(Math.max(0, Math.min(at, view.state.doc.length))).number)
      }
      this.stopDrag?.()
      const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); window.removeEventListener('blur', stop); this.stopDrag = undefined }
      this.stopDrag = stop
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop); window.addEventListener('blur', stop)
      return true
    }
    const commands: Record<string, (view: EditorView) => boolean> = {
      find: openCodeSearch,
      replace: view => { openCodeSearch(view); view.dom.querySelector<HTMLInputElement>('[aria-label="代码替换为"]')?.focus(); return true },
      format: () => { void this.format(); return true }, indent: indentMore, unindent: indentLess,
      comment: toggleComment, blockComment: toggleBlockComment,
      duplicate: view => {
        if (view.state.selection.ranges.every(range => range.empty)) return copyLineDown(view)
        if (view.state.readOnly) return false
        view.dispatch(view.state.changeByRange(range => {
          const text = view.state.sliceDoc(range.from, range.to)
          return { changes: { from: range.to, insert: text }, range: EditorSelection.range(range.to, range.to + text.length) }
        }), { userEvent: 'input' })
        return true
      },
      delete: deleteLine, moveUp: moveLineUp, moveDown: moveLineDown, next: selectNextOccurrence,
      fold: foldCode, unfold: unfoldCode, foldAll, unfoldAll,
    }
    const keys: KeyBinding[] = [
      ...(options.keys ?? []),
      ...codeKeys.flatMap(binding => commands[binding.action] ? [{ key: binding.key, mac: 'mac' in binding ? binding.mac : undefined, run: commands[binding.action], preventDefault: true }] : []),
      { key: 'Escape', run: view => { if (!searchPanelOpen(view.state)) return false; closeSearchPanel(view); return true } },
      ...closeBracketsKeymap, ...completionKeymap,
      { key: 'Escape', run: simplifySelection },
      // Keep normal text navigation without CodeMirror's VS Code-style editing shortcuts.
      ...standardKeymap,
    ]
    this.view = new EditorView({ parent: host, doc: options.doc, extensions: [
      EditorState.readOnly.of(!!options.readOnly), EditorState.allowMultipleSelections.of(true),
      EditorView.contentAttributes.of({ 'aria-label': options.readOnly ? '代码内容' : '代码编辑区', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      lineNumbers({ domEventHandlers: { mousedown: lineSelection } }), highlightActiveLineGutter(),
      foldGutter({ markerDOM: open => { const b = document.createElement('span'); b.className = 'yy-code-fold-marker'; b.textContent = open ? '⌄' : '›'; b.dataset.tip = open ? '折叠代码区域' : '展开代码区域'; return b } }),
      codeFolding({ preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
        placeholderDOM: (_view, click, lines) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'yy-code-fold-placeholder'; b.textContent = `⋯ ${lines} 行`; b.dataset.tip = '展开代码区域'; b.setAttribute('aria-label', `展开 ${lines} 行代码`); b.onclick = click; return b } }),
      this.language.of([]), this.wrapping.of(this.preferences.wrapped ? EditorView.lineWrapping : []),
      indentUnit.of('    '), EditorState.tabSize.of(4), indentOnInput(), bracketMatching(), closeBrackets(),
      autocompletion(), rectangularSelection(), drawSelection(), highlightActiveLine(), oneDark, syntaxHighlighting(classHighlighter),
      search({ top: true, createPanel: codeSearchPanel }), externalHighlights,
      EditorState.phrases.of({ 'Fold line': '折叠代码区域', 'Unfold line': '展开代码区域' }),
      Prec.highest(keymap.of(keys)),
      EditorView.updateListener.of(update => {
        if (update.docChanged) this.version++
        if (!this.syncing && (update.docChanged || update.selectionSet || update.focusChanged)) options.onUpdate?.(update)
        if (update.docChanged || update.transactions.some(tr => tr.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect)))) this.save()
      }),
    ] })
    Object.assign(host, { codeEditor: this })
    host.classList.add('yy-code-editor-host')
    // CodeMirror's native titles are routed through the application's shared tooltip.
    const tips = () => { for (const el of host.querySelectorAll<HTMLElement>('[title]')) { el.dataset.tip = el.getAttribute('title')!; el.removeAttribute('title') } }
    this.observer = new MutationObserver(tips); this.observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] })
    void this.setLanguage(options.language)
    if (this.preferences.hash === codeHash(options.doc)) {
      const effects = (this.preferences.folds ?? []).filter(r => r.from >= 0 && r.from < r.to && r.to <= options.doc.length).map(r => foldEffect.of(r))
      if (effects.length) this.view.dispatch({ effects })
    }
  }

  async setLanguage(name: string) {
    this.languageName = name
    const generation = ++this.generation
    const language = await codeLanguage(name)
    if (!this.destroyed && generation === this.generation) this.view.dispatch({ effects: this.language.reconfigure(language) })
  }
  setWrapped(value: boolean) {
    this.preferences.wrapped = value
    this.view.dispatch({ effects: this.wrapping.reconfigure(value ? EditorView.lineWrapping : []) })
    this.save()
  }
  private save() {
    const folds: { from: number; to: number }[] = []
    foldedRanges(this.view.state).between(0, this.view.state.doc.length, (from, to) => { folds.push({ from, to }) })
    this.preferences = { ...this.preferences, hash: codeHash(this.view.state.doc.toString()), folds }
    saveCodePreferences(this.options.key, this.preferences)
    this.options.onPreferences?.(this.preferences)
  }
  setText(text: string) {
    const current = this.view.state.doc.toString()
    if (current === text) return
    let start = 0, oldEnd = current.length, newEnd = text.length
    while (start < oldEnd && start < newEnd && current[start] === text[start]) start++
    while (oldEnd > start && newEnd > start && current[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd-- }
    this.syncing = true
    this.view.dispatch({ changes: { from: start, to: oldEnd, insert: text.slice(start, newEnd) } })
    this.syncing = false
  }
  setSelection(anchor: number, head: number, focus = false) {
    const length = this.view.state.doc.length
    anchor = Math.max(0, Math.min(anchor, length)); head = Math.max(0, Math.min(head, length))
    const main = this.view.state.selection.main
    const effects: ReturnType<typeof unfoldEffect.of>[] = []
    foldedRanges(this.view.state).between(Math.min(anchor, head), Math.max(anchor, head), (from, to) => { effects.push(unfoldEffect.of({ from, to })) })
    this.syncing = true
    if (main.anchor !== anchor || main.head !== head || effects.length) this.view.dispatch({ selection: EditorSelection.single(anchor, head), effects })
    if (focus) this.view.focus()
    this.syncing = false
  }
  find() { openCodeSearch(this.view) }
  highlight(matches: { from: number; to: number; current: boolean }[]) { this.view.dispatch({ effects: externalMatches.of(matches) }) }
  revealSelection() { this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: 'center' }) }) }
  foldAll() { foldAll(this.view) }
  unfoldAll() { unfoldAll(this.view) }
  private status(message: string, persistent = false) {
    clearTimeout(this.feedbackTimer)
    this.feedback ??= Object.assign(document.createElement('div'), { className: 'yy-code-format-status' })
    this.feedback.setAttribute('role', 'status'); this.feedback.textContent = message
    this.view.dom.append(this.feedback)
    if (!persistent) this.feedbackTimer = setTimeout(() => this.feedback?.remove(), 5000)
  }
  async format() {
    if (this.formatting || this.options.readOnly) return
    if (!formatLanguage(this.languageName)) { this.status('当前语言暂不支持格式化'); return }
    const original = this.view.state.doc.toString(), version = this.version, generation = this.generation
    this.formatting = true; this.status('正在格式化…', true)
    try {
      const { formatCode, formatChanges } = await import('./format')
      const formatted = await formatCode(original, this.languageName)
      if (this.destroyed) return
      if (version !== this.version || generation !== this.generation) { this.status('代码已变化，请重新格式化'); return }
      if (formatted === original) { this.status('代码格式已整齐'); return }
      this.view.dispatch({ changes: formatChanges(original, formatted), userEvent: 'input.format' })
      this.status('已格式化，可撤销')
      this.view.focus()
    } catch (error) { if (!this.destroyed) this.status(error instanceof Error ? error.message : '格式化失败，请重试') }
    finally { this.formatting = false }
  }
  destroy() { this.destroyed = true; clearTimeout(this.feedbackTimer); this.stopDrag?.(); this.observer.disconnect(); this.view.destroy(); delete (this.host as CodeHost).codeEditor }
}

export type CodeHost = HTMLElement & { codeEditor?: CodeEditor }
export function codeEditorIn(dom: Element) { return (dom.querySelector('.yy-code-editor-host') as CodeHost | null)?.codeEditor }
