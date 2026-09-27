import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection, type DecorationSet, type KeyBinding, type ViewUpdate } from '@codemirror/view'
import { bracketMatching, codeFolding, foldAll, foldCode, foldedRanges, foldEffect, foldGutter, indentOnInput, indentUnit, syntaxHighlighting, unfoldAll, unfoldCode, unfoldEffect } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { defaultKeymap, deleteLine, indentLess, indentMore, insertTab, moveLineDown, moveLineUp, copyLineDown, copyLineUp, toggleComment } from '@codemirror/commands'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { closeSearchPanel, gotoLine, search, searchPanelOpen, selectNextOccurrence } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { codeLanguage } from './language'
import { codeHash, readCodePreferences, saveCodePreferences, type CodePreferences } from './preferences'
import { codeSearchPanel, openCodeSearch } from './search'
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
  private indentation = new Compartment()
  private generation = 0
  private syncing = false
  private destroyed = false
  private stopDrag?: () => void
  private observer: MutationObserver

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
    const keys: KeyBinding[] = [
      ...(options.keys ?? []),
      { key: 'Mod-f', run: openCodeSearch }, { key: 'Mod-h', mac: 'Alt-Mod-f', run: openCodeSearch },
      { key: 'Mod-g', run: gotoLine }, { key: 'Mod-/', run: toggleComment },
      { key: 'Alt-ArrowUp', run: moveLineUp }, { key: 'Alt-ArrowDown', run: moveLineDown },
      { key: 'Shift-Alt-ArrowUp', run: copyLineUp }, { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
      { key: 'Shift-Mod-k', run: deleteLine }, { key: 'Mod-d', run: selectNextOccurrence },
      { key: 'Mod-[', run: indentLess }, { key: 'Mod-]', run: indentMore },
      { key: 'Shift-Mod-[', run: foldCode }, { key: 'Shift-Mod-]', run: unfoldCode },
      { key: 'Tab', run: view => this.preferences.indent === 'tab' && view.state.selection.main.empty ? insertTab(view) : indentMore(view) },
      { key: 'Shift-Tab', run: indentLess },
      { key: 'Escape', run: view => { if (!searchPanelOpen(view.state)) return false; closeSearchPanel(view); return true } },
      ...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap,
    ]
    this.view = new EditorView({ parent: host, doc: options.doc, extensions: [
      EditorState.readOnly.of(!!options.readOnly), EditorState.allowMultipleSelections.of(true),
      EditorView.contentAttributes.of({ 'aria-label': options.readOnly ? '代码内容' : '代码编辑区', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      lineNumbers({ domEventHandlers: { mousedown: lineSelection } }), highlightActiveLineGutter(),
      foldGutter({ markerDOM: open => { const b = document.createElement('span'); b.className = 'yy-code-fold-marker'; b.textContent = open ? '⌄' : '›'; b.dataset.tip = open ? '折叠代码区域' : '展开代码区域'; return b } }),
      codeFolding({ preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
        placeholderDOM: (_view, click, lines) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'yy-code-fold-placeholder'; b.textContent = `⋯ ${lines} 行`; b.dataset.tip = '展开代码区域'; b.setAttribute('aria-label', `展开 ${lines} 行代码`); b.onclick = click; return b } }),
      this.language.of([]), this.wrapping.of(this.preferences.wrapped ? EditorView.lineWrapping : []),
      this.indentation.of(this.indentExtension()), indentOnInput(), bracketMatching(), closeBrackets(),
      autocompletion(), rectangularSelection(), drawSelection(), highlightActiveLine(), oneDark, syntaxHighlighting(classHighlighter),
      search({ top: true, createPanel: codeSearchPanel }), externalHighlights,
      EditorState.phrases.of({ 'Go to line': '跳转到行', 'go': '跳转', 'Fold line': '折叠代码区域', 'Unfold line': '展开代码区域' }),
      Prec.highest(keymap.of(keys)),
      EditorView.updateListener.of(update => {
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

  private indentExtension(): Extension {
    const indent = this.preferences.indent === 'tab' ? '\t' : ' '.repeat(Number(this.preferences.indent))
    return [indentUnit.of(indent), EditorState.tabSize.of(this.preferences.indent === '2' ? 2 : 4)]
  }
  async setLanguage(name: string) {
    const generation = ++this.generation
    const language = await codeLanguage(name)
    if (!this.destroyed && generation === this.generation) this.view.dispatch({ effects: this.language.reconfigure(language) })
  }
  setWrapped(value: boolean) {
    this.preferences.wrapped = value
    this.view.dispatch({ effects: this.wrapping.reconfigure(value ? EditorView.lineWrapping : []) })
    this.save()
  }
  setIndent(value: CodePreferences['indent']) {
    this.preferences.indent = value
    this.view.dispatch({ effects: this.indentation.reconfigure(this.indentExtension()) })
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
  goto() { gotoLine(this.view) }
  foldAll() { foldAll(this.view) }
  unfoldAll() { unfoldAll(this.view) }
  destroy() { this.destroyed = true; this.stopDrag?.(); this.observer.disconnect(); this.view.destroy(); delete (this.host as CodeHost).codeEditor }
}

export type CodeHost = HTMLElement & { codeEditor?: CodeEditor }
export function codeEditorIn(dom: Element) { return (dom.querySelector('.yy-code-editor-host') as CodeHost | null)?.codeEditor }
