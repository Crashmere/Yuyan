import { copyText } from '../../shared/clipboard'
import { needsDisplay } from '../../shared/latex'
import { renderMermaid } from '../../shared/mermaid'

// What the server-rendered HTML leaves to the browser: code lines, folding and copy buttons,
// formulas and diagrams. KaTeX and Mermaid load only for pages that contain them.
export function enhance(root: HTMLElement, options: { math: boolean; mermaid: boolean }) {
  enhanceCode(root)
  if (options.math) void renderMath(root)
  if (options.mermaid) void renderDiagrams(root)
}

// Longer code blocks start folded to about this many lines.
const foldLines = 30

function enhanceCode(root: HTMLElement) {
  for (const pre of root.querySelectorAll<HTMLElement>('pre')) {
    const code = pre.querySelector('code')
    if (!code || code.classList.contains('language-mermaid') || pre.dataset.enhanced) continue
    pre.dataset.enhanced = '1'
    const text = code.textContent ?? ''
    const lines = splitLines(code)
    addCopyButton(pre, text)
    if (lines > foldLines + 5) addFold(pre, lines)
  }
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

function addCopyButton(pre: HTMLElement, text: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'yy-copy'
  button.textContent = '复制'
  button.addEventListener('click', async () => {
    button.textContent = (await copyText(text)) ? '已复制' : '复制失败'
    setTimeout(() => (button.textContent = '复制'), 1500)
  })
  pre.appendChild(button)
}

function addFold(pre: HTMLElement, lines: number) {
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
    if (folded && pre.getBoundingClientRect().top < 0) pre.scrollIntoView({ block: 'start' })
  })
  pre.after(button)
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
