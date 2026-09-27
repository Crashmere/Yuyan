import { languages } from '../../editor/languages'
import type { ImageSizes } from '../../shared/api'
import { copyText } from '../../shared/clipboard'
import { codeIcon } from '../../shared/codeIcons'
import { assetId, reservedSize } from '../../shared/images'
import { needsDisplay } from '../../shared/latex'
import { renderMermaid } from '../../shared/mermaid'
import { frameTable } from '../../shared/tableFrame'

// What the server-rendered HTML leaves to the browser: space for images, code lines, folding and
// copy buttons, formulas and diagrams. KaTeX and Mermaid load only for pages that contain them.
// The returned promise settles once formulas and diagrams are drawn.
export async function enhance(root: HTMLElement, options: { math: boolean; mermaid: boolean; images?: ImageSizes }) {
  if (options.images) reserveImageSpace(root, options.images)
  enhanceCode(root)
  frameTables(root)
  await Promise.all([options.math && renderMath(root), options.mermaid && renderDiagrams(root)])
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
  for (const pre of root.querySelectorAll<HTMLElement>('pre')) {
    const code = pre.querySelector('code')
    if (!code || pre.dataset.enhanced) continue
    pre.dataset.enhanced = '1'
    const language = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]
    if (language === 'mermaid') continue
    const text = code.textContent ?? ''
    const lines = splitLines(code)
    const block = addTitleBar(pre, language, text)
    addCopyButton(pre, text)
    // A block saved with a title bar collapses from it instead of starting folded.
    if (block.classList.contains('no-title') && lines > foldLines + 5) addFold(pre, block, lines)
  }
}

// Every code block gets Yuque's title bar (schema/codeBlock.ts), hidden on blocks saved without
// one. The tab at the top of the code, just below the bar when it shows, shows or hides it for
// this visit only; the document keeps what the editor saved.
function addTitleBar(pre: HTMLElement, language: string | undefined, text: string): HTMLElement {
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
  wrap.setAttribute('aria-pressed', 'false')
  wrap.dataset.tip = '开启自动换行'
  wrap.addEventListener('click', () => {
    const on = block.classList.toggle('is-wrapped')
    wrap.setAttribute('aria-pressed', String(on))
    wrap.dataset.tip = on ? '关闭自动换行' : '开启自动换行'
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
  code.replaceChildren(...lines)
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
      pre.insertAdjacentHTML('afterend', '<p class="yy-mermaid-error">图表渲染失败，显示原始代码。</p>')
      console.warn('mermaid', e)
    }
  }
}
