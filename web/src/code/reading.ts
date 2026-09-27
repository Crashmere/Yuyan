import { codeFolds } from './language'
import { codeHash, readCodePreferences, saveCodePreferences } from './preferences'
import { expandCode, type CodeAction } from './actions'

export async function readingCode(block: HTMLElement, source: string, language: string, key: string, title: string) {
  const lines = [...block.querySelectorAll<HTMLElement>('pre > code .yy-line')]
  const ranges = await codeFolds(source, language)
  let destroyed = false
  let closeExpanded: (() => void) | undefined
  let stopDrag: (() => void) | undefined
  const preferences = readCodePreferences(key)
  const folded = new Set<number>()
  if (preferences.hash === codeHash(source)) for (const range of ranges) {
    if (preferences.folds?.some(saved => saved.from === range.from && saved.to === range.to)) folded.add(range.from)
  }
  const buttons: HTMLElement[] = []
  const foldButtons = new Map<number, HTMLButtonElement>()
  const placeholders = new Map<number, HTMLButtonElement>()
  const render = (save = true) => {
    const closed = ranges.filter(range => folded.has(range.from))
    lines.forEach((line, index) => line.classList.toggle('yy-code-line-hidden', closed.some(range => index + 1 > range.first && index + 1 <= range.last)))
    for (const range of ranges) {
      const isFolded = folded.has(range.from), button = foldButtons.get(range.from)!, placeholder = placeholders.get(range.from)!
      button.textContent = isFolded ? '›' : '⌄'
      button.setAttribute('aria-label', `${isFolded ? '展开' : '折叠'}第 ${range.first} 行代码区域`)
      button.setAttribute('aria-expanded', String(!isFolded))
      button.dataset.tip = isFolded ? '展开代码区域' : '折叠代码区域'
      placeholder.hidden = !isFolded
    }
    if (save) saveCodePreferences(key, { ...readCodePreferences(key), hash: codeHash(source), folds: closed.map(({ from, to }) => ({ from, to })) })
  }
  const toggle = (from: number) => { if (folded.has(from)) folded.delete(from); else folded.add(from); render() }
  for (const range of ranges) {
    const line = lines[range.first - 1]
    if (!line) continue
    const button = document.createElement('button'); button.type = 'button'; button.className = 'yy-code-region-fold'; button.onclick = () => toggle(range.from)
    const placeholder = document.createElement('button'); placeholder.type = 'button'; placeholder.className = 'yy-code-region-placeholder'; placeholder.textContent = `⋯ ${range.last - range.first} 行`; placeholder.dataset.tip = '展开代码区域'; placeholder.onclick = () => toggle(range.from)
    line.querySelector('.yy-code-gutter')!.append(button); line.querySelector('.yy-code-text')!.append(placeholder); buttons.push(button, placeholder)
    foldButtons.set(range.from, button); placeholders.set(range.from, placeholder)
  }
  let selectionAnchor = 0
  const select = (first: number, last: number) => {
    const range = document.createRange()
    const start = lines[Math.min(first, last)], end = lines[Math.max(first, last)]
    if (!start || !end) return
    // Only code text participates; gutter controls are excluded from copying.
    const walker = (el: Element) => document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement?.closest('button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT })
    const begin = walker(start).nextNode()
    const endWalker = walker(end); let finish: Node | null = null
    for (let node = endWalker.nextNode(); node; node = endWalker.nextNode()) finish = node
    if (!begin || !finish) return
    range.setStart(begin, 0); range.setEnd(finish, finish.textContent!.length)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    lines.forEach((line, i) => line.classList.toggle('yy-code-line-selected', i >= Math.min(first, last) && i <= Math.max(first, last)))
  }
  lines.forEach((line, index) => {
    const number = document.createElement('button'); number.type = 'button'; number.className = 'yy-code-line-select'; number.setAttribute('aria-label', `选择第 ${index + 1} 行代码`)
    number.onmousedown = e => {
      if (e.button !== 0) return
      e.preventDefault(); if (!e.shiftKey) selectionAnchor = index; select(selectionAnchor, index)
      const move = (event: MouseEvent) => {
        const hit = lines.findIndex(line => { const rect = line.getBoundingClientRect(); return rect.height && event.clientY >= rect.top && event.clientY < rect.bottom })
        if (hit >= 0) select(selectionAnchor, hit)
      }
      stopDrag?.()
      const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); window.removeEventListener('blur', stop); stopDrag = undefined }
      stopDrag = stop; window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop); window.addEventListener('blur', stop)
    }
    number.onclick = e => { if (e.detail === 0) { selectionAnchor = index; select(index, index) } }
    line.querySelector('.yy-code-gutter')!.append(number); buttons.push(number)
  })
  const clearSelected = (e: Event) => { if (!(e.target as Element)?.closest('.yy-code-line-select')) lines.forEach(line => line.classList.remove('yy-code-line-selected')) }
  block.addEventListener('mousedown', clearSelected)
  render(false)
  // Search and position restoration can reveal a previously folded code line.
  const reveal = (e: Event) => {
    const line = (e.target as Element).closest('.yy-line')
    if (!line) return
    const index = lines.indexOf(line as HTMLElement) + 1
    for (const range of ranges) if (index > range.first && index <= range.last) folded.delete(range.from)
    render()
  }
  block.addEventListener('yy-reveal-code', reveal)
  return {
    async action(action: CodeAction) {
      if (action === 'fold' || action === 'unfold') { if (action === 'fold') ranges.forEach(range => folded.add(range.from)); else folded.clear(); render(); return }
      const { CodeEditor } = await import('./editor')
      if (destroyed || !block.isConnected) return
      closeExpanded?.()
      const host = document.createElement('div'); host.hidden = true; block.append(host)
      const code = new CodeEditor(host, { doc: source, language, key, readOnly: true })
      closeExpanded = expandCode(code, title || language || '代码块', () => {
        const current = readCodePreferences(key); folded.clear()
        for (const range of ranges) if (current.folds?.some(saved => saved.from === range.from && saved.to === range.to)) folded.add(range.from)
        block.classList.toggle('is-wrapped', current.wrapped)
        const wrap = block.querySelector<HTMLElement>('.yy-code-wrap-btn')
        wrap?.setAttribute('aria-pressed', String(current.wrapped))
        if (wrap) wrap.dataset.tip = current.wrapped ? '关闭自动换行' : '开启自动换行'
        render(false); code.destroy(); host.remove(); closeExpanded = undefined
      })
      if (action === 'find') code.find()
    },
    destroy() { destroyed = true; closeExpanded?.(); stopDrag?.(); block.removeEventListener('mousedown', clearSelected); block.removeEventListener('yy-reveal-code', reveal); buttons.forEach(button => button.remove()) },
  }
}
