import type { EditorView, Panel } from '@codemirror/view'
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, setSearchQuery } from '@codemirror/search'

export function openCodeSearch(view: EditorView) {
  const previous = getSearchQuery(view.state)
  openSearchPanel(view)
  const current = getSearchQuery(view.state)
  // Opening from a selection seeds the query; keep the user's replacement alongside it.
  if (current.replace !== previous.replace) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...current, replace: previous.replace })) })
  return true
}

// Code-only search. The document's own search stays available from its main toolbar.
export function codeSearchPanel(view: EditorView): Panel {
  const initial = getSearchQuery(view.state)
  const dom = document.createElement('div')
  dom.className = 'yy-code-search'
  const query = document.createElement('input')
  query.placeholder = '在此代码块中查找'
  query.setAttribute('aria-label', '在此代码块中查找')
  query.setAttribute('main-field', 'true')
  query.value = initial.search
  const replacement = document.createElement('input')
  replacement.placeholder = '替换为'
  replacement.setAttribute('aria-label', '代码替换为')
  replacement.value = initial.replace
  const count = document.createElement('span')
  count.className = 'yy-code-search-count'
  count.setAttribute('aria-live', 'polite')
  let matchCase = initial.caseSensitive, regexp = initial.regexp
  const submit = () => {
    const previous = getSearchQuery(view.state)
    const next = new SearchQuery({ search: query.value, replace: replacement.value, caseSensitive: matchCase, regexp })
    view.dispatch({ effects: setSearchQuery.of(next) })
    if (next.valid && (previous.search !== next.search || previous.caseSensitive !== next.caseSensitive || previous.regexp !== next.regexp)) findNext(view)
  }
  const button = (label: string, action: () => void, text = label) => {
    const b = document.createElement('button')
    b.type = 'button'; b.textContent = text; b.dataset.tip = label; b.setAttribute('aria-label', label)
    b.addEventListener('mousedown', e => e.preventDefault())
    b.addEventListener('click', action)
    return b
  }
  const row = document.createElement('div')
  const caseButton = button('区分大小写', () => { matchCase = !matchCase; caseButton.setAttribute('aria-pressed', String(matchCase)); submit() }, 'Aa')
  const regexButton = button('使用正则表达式', () => { regexp = !regexp; regexButton.setAttribute('aria-pressed', String(regexp)); submit() }, '.*')
  caseButton.setAttribute('aria-pressed', String(matchCase)); regexButton.setAttribute('aria-pressed', String(regexp))
  row.append(query, caseButton, regexButton, count, button('上一个匹配', () => { findPrevious(view) }, '↑'), button('下一个匹配', () => { findNext(view) }, '↓'), button('关闭代码查找', () => { closeSearchPanel(view); view.focus() }, '×'))
  dom.append(row)
  if (!view.state.readOnly) {
    const replaceRow = document.createElement('div')
    replaceRow.append(replacement, button('替换当前匹配', () => { replaceNext(view) }, '替换'), button('替换此代码块中的全部匹配', () => { replaceAll(view) }, '全部替换'))
    dom.append(replaceRow)
  }
  query.addEventListener('input', submit); replacement.addEventListener('input', submit)
  dom.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearchPanel(view); view.focus() }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.shiftKey ? findPrevious(view) : findNext(view) }
  })
  const update = () => {
    const q = getSearchQuery(view.state)
    if (query.value !== q.search) query.value = q.search
    if (replacement.value !== q.replace) replacement.value = q.replace
    matchCase = q.caseSensitive; regexp = q.regexp
    caseButton.setAttribute('aria-pressed', String(matchCase)); regexButton.setAttribute('aria-pressed', String(regexp))
    if (!q.search) { count.textContent = ''; return }
    if (!q.valid) { count.textContent = '表达式有误'; return }
    const cursor = q.getCursor(view.state.doc)
    let total = 0, current = 0
    for (let next = cursor.next(); !next.done && total < 10000; next = cursor.next()) { total++; if (next.value.from <= view.state.selection.main.from) current = total }
    count.textContent = total ? `${current}/${total}${total === 10000 ? '+' : ''}` : '无匹配'
  }
  return { dom, top: true, mount() { query.focus(); query.select(); update() }, update }
}
