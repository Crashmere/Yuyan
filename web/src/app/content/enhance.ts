import { languages } from '../../editor/languages'
import type { ImageSizes } from '../../shared/api'
import { copyText } from '../../shared/clipboard'
import { codeIcon } from '../../shared/codeIcons'
import { assetId, reservedSize } from '../../shared/images'
import { needsDisplay } from '../../shared/latex'
import { mermaidError, renderMermaid } from '../../shared/mermaid'
import { frameTable } from '../../shared/tableFrame'
import { codeActions, type CodeAction } from '../../code/actions'
import { codeKey, readCodePreferences, saveCodePreferences } from '../../code/preferences'

const cleanups = new WeakMap<HTMLElement, (() => void)[]>()
export function cleanupCode(root: HTMLElement) { cleanups.get(root)?.forEach(cleanup => cleanup()); cleanups.delete(root) }

// What the server-rendered HTML leaves to the browser: space for images, code lines, folding and
// copy buttons, formulas and diagrams. KaTeX and Mermaid load only for pages that contain them.
// The returned promise settles once formulas and diagrams are drawn.
export async function enhance(root: HTMLElement, options: { math: boolean; mermaid: boolean; images?: ImageSizes }) {
  cleanupCode(root)
  if (options.images) reserveImageSpace(root, options.images)
  const codeReady = enhanceCode(root)
  frameTables(root)
  await Promise.all([codeReady, options.math && renderMath(root), options.mermaid && renderDiagrams(root)])
}

// Wide tables scroll sideways in a frame (shared/tableFrame.ts).
function frameTables(root: HTMLElement) {
  for (const table of root.querySelectorAll('table')) {
    const frame = Object.assign(document.createElement('div'), { className: 'yy-table-frame' })
    const scroller = frame.appendChild(Object.assign(document.createElement('div'), { className: 'yy-table-scroll' }))
    table.replaceWith(frame)
    scroller.append(table)
    frameTable(frame, scroller)
  }
}

// Lazily loaded images take no space until they arrive, which pushes the text below them down
// and makes jumps to headings land in the wrong place; the stored sizes reserve the space.
function reserveImageSpace(root: HTMLElement, sizes: ImageSizes) {
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    const id = assetId(img.getAttribute('src') ?? '')
    const r = reservedSize(id ? sizes[id] : undefined, Number(img.getAttribute('width')) || null, Number(img.getAttribute('height')) || null)
    if (r.width) img.setAttribute('width', String(r.width))
    if (r.aspectRatio) img.style.aspectRatio = r.aspectRatio
  }
}

// Longer code blocks start folded to about this many lines.
const foldLines = 30

function enhanceCode(root: HTMLElement) {
  const cleanup: (() => void)[] = []
  const restoring: Promise<unknown>[] = []
  cleanups.set(root, cleanup)
  let index = 0
  for (const pre of root.querySelectorAll<HTMLElement>('pre')) {
    const code = pre.querySelector('code')
    if (!code || pre.dataset.enhanced) continue
    pre.dataset.enhanced = '1'
    const language = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]
    const key = codeKey(index++)
    if (language === 'mermaid') continue
    const text = code.textContent ?? ''
    const lines = splitLines(code)
    const block = addTitleBar(pre, language, text, key)
    addCopyButton(pre, text)
    const title = block.querySelector('.code-title')?.firstChild?.textContent ?? ''
    let loading: Promise<Awaited<ReturnType<typeof import('../../code/reading')['readingCode']>> | undefined> | undefined
    let disposed = false
    const activate = () => loading ??= import('../../code/reading').then(async module => {
      if (disposed || !block.isConnected) return
      const reader = await module.readingCode(block, text, language ?? '', key, title)
      if (disposed) { reader.destroy(); return }
      return reader
    })
    const run = (action: CodeAction) => { void activate().then(reader => reader?.action(action)) }
    const actions = document.createElement('span'); actions.className = 'yy-code-actions'
    block.append(actions)
    cleanup.push(codeActions(actions, run))
    const hover = () => { void activate() }
    block.addEventListener('pointerenter', hover, { once: true })
    block.addEventListener('focusin', hover, { once: true })
    // Restore local folds before positioning a returning reader, without waiting for a hover.
    if (readCodePreferences(key).folds?.length) restoring.push(activate())
    cleanup.push(() => { disposed = true; block.removeEventListener('pointerenter', hover); block.removeEventListener('focusin', hover); void loading?.then(reader => reader?.destroy()) })
    // A block saved with a title bar collapses from it instead of starting folded.
    if (block.classList.contains('no-title') && lines > foldLines + 5) addFold(pre, block, lines)
  }
  return Promise.all(restoring)
}

// Every code block gets Yuque's title bar (schema/codeBlock.ts), hidden on blocks saved without
// one. The tab on the bar's lower edge shows or hides it for
// this visit only; the document keeps what the editor saved.
function addTitleBar(pre: HTMLElement, language: string | undefined, text: string, key: string): HTMLElement {
  let block = pre.parentElement!
  if (!block.classList.contains('code-block')) {
    block = Object.assign(document.createElement('div'), { className: 'code-block no-title' })
    pre.replaceWith(block)
    block.append(Object.assign(document.createElement('div'), { className: 'code-title' }), pre)
  }
  const bar = block.querySelector(':scope > .code-title')!
  const label = Object.assign(document.createElement('span'), { className: 'code-lang' })
  label.textContent = languages.find((l) => l.id === language || l.aliases.includes(language ?? ''))?.label ?? language ?? '纯文本'
  bar.appendChild(label)
  const wrap = Object.assign(document.createElement('button'), { type: 'button', className: 'yy-code-wrap-btn' })
  wrap.append(codeIcon('wrap'), Object.assign(document.createElement('span'), { textContent: '自动换行' }))
  wrap.setAttribute('aria-label', '自动换行')
  const wrapped = readCodePreferences(key).wrapped
  block.classList.toggle('is-wrapped', wrapped)
  wrap.setAttribute('aria-pressed', String(wrapped))
  wrap.dataset.tip = wrapped ? '关闭自动换行' : '开启自动换行'
  wrap.addEventListener('click', () => {
    const on = block.classList.toggle('is-wrapped')
    wrap.setAttribute('aria-pressed', String(on))
    wrap.dataset.tip = on ? '关闭自动换行' : '开启自动换行'
    saveCodePreferences(key, { ...readCodePreferences(key), wrapped: on })
    if (on) pre.querySelector('code')!.scrollLeft = 0
  })
  bar.appendChild(wrap)
  addCopyButton(bar, text)
  const tab = Object.assign(document.createElement('button'), { type: 'button', className: 'code-tab' })
  const update = () => {
    const hidden = block.classList.contains('no-title')
    tab.classList.toggle('is-down', hidden)
    const label = hidden ? '显示标题栏' : '隐藏标题栏'
    tab.dataset.tip = label
    tab.setAttribute('aria-label', label)
  }
  tab.addEventListener('click', () => {
    block.classList.toggle('no-title')
    block.classList.remove('is-collapsed')
    update()
  })
  update()
  pre.prepend(tab)
  return block
}

// splitLines wraps each line of highlighted code in its own element, so line numbers and wrapped
// lines line up (see content.css). Highlight spans that run across lines are split with them.
function splitLines(code: HTMLElement): number {
  const lines: HTMLElement[] = []
  const open: HTMLElement[] = []
  const newLine = () => Object.assign(document.createElement('span'), { className: 'yy-line' })
  let line = newLine()
  const current = () => open[open.length - 1] ?? line
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      ;(node.textContent ?? '').split('\n').forEach((part, i) => {
        if (i > 0) {
          lines.push(line)
          line = newLine()
          let parent: HTMLElement = line
          open.forEach((el, j) => {
            const copy = el.cloneNode(false) as HTMLElement
            parent.appendChild(copy)
            open[j] = copy
            parent = copy
          })
        }
        if (part) current().appendChild(document.createTextNode(part))
      })
    } else if (node instanceof HTMLElement) {
      const copy = node.cloneNode(false) as HTMLElement
      current().appendChild(copy)
      open.push(copy)
      node.childNodes.forEach(walk)
      open.pop()
    }
  }
  code.childNodes.forEach(walk)
  if (line.textContent || !lines.length) lines.push(line)
  lines.forEach((line, i) => {
    line.dataset.line = String(i + 1)
    const gutter = document.createElement('span'); gutter.className = 'yy-code-gutter'; gutter.dataset.line = String(i + 1)
    const text = document.createElement('span'); text.className = 'yy-code-text'; text.append(...line.childNodes)
    line.replaceChildren(gutter, text)
  })
  const rows = document.createElement('span'); rows.className = 'yy-code-lines'; rows.append(...lines)
  code.replaceChildren(rows)
  return lines.length
}

function addCopyButton(parent: Element, text: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'yy-copy'
  const label = Object.assign(document.createElement('span'), { textContent: '复制' })
  button.append(codeIcon('copy'), label)
  button.setAttribute('aria-label', '复制')
  button.dataset.tip = '复制代码'
  button.addEventListener('click', async () => {
    const copied = await copyText(text)
    label.textContent = copied ? '已复制' : '复制失败'
    button.setAttribute('aria-label', label.textContent)
    button.dataset.tip = label.textContent
    button.replaceChild(codeIcon(copied ? 'check' : 'copy'), button.firstElementChild!)
    setTimeout(() => {
      label.textContent = '复制'
      button.setAttribute('aria-label', '复制')
      button.dataset.tip = '复制代码'
      button.replaceChild(codeIcon('copy'), button.firstElementChild!)
    }, 1500)
  })
  parent.appendChild(button)
}

function addFold(pre: HTMLElement, block: HTMLElement, lines: number) {
  pre.classList.add('is-folded')
  pre.style.setProperty('--yy-fold-lines', String(foldLines))
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'yy-code-fold'
  const label = () => (pre.classList.contains('is-folded') ? `展开全部 ${lines} 行` : '收起代码')
  button.textContent = label()
  button.addEventListener('click', () => {
    const folded = pre.classList.toggle('is-folded')
    button.textContent = label()
    // Collapsing a block read to its end would otherwise leave the page far below it.
    if (folded && block.getBoundingClientRect().top < 0) block.scrollIntoView({ block: 'start' })
  })
  block.after(button)
}

async function renderMath(root: HTMLElement) {
  const nodes = root.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]')
  if (!nodes.length) return
  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
  for (const el of nodes) {
    const latex = el.dataset.latex ?? ''
    katex.render(latex, el, { displayMode: el.dataset.type === 'block-math' || needsDisplay(latex), throwOnError: false })
  }
}

async function renderDiagrams(root: HTMLElement) {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
    const pre = code.parentElement!
    try {
      const box = document.createElement('div')
      box.className = 'yy-mermaid'
      box.innerHTML = await renderMermaid(code.textContent ?? '')
      pre.replaceWith(box)
    } catch (e) {
      const notice = document.createElement('p')
      notice.className = 'yy-mermaid-error'
      notice.textContent = `${mermaidError(e)} 已保留原始代码。`
      pre.after(notice)
      console.warn('mermaid', e)
    }
  }
}
