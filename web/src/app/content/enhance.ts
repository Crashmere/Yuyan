import { copyText } from '../../shared/clipboard'
import { needsDisplay } from '../../shared/latex'
import { renderMermaid } from '../../shared/mermaid'

// What the server-rendered HTML leaves to the browser: copy buttons, formulas and diagrams.
// KaTeX and Mermaid load only for pages that contain them.
export function enhance(root: HTMLElement, options: { math: boolean; mermaid: boolean }) {
  addCopyButtons(root)
  if (options.math) void renderMath(root)
  if (options.mermaid) void renderDiagrams(root)
}

function addCopyButtons(root: HTMLElement) {
  for (const pre of root.querySelectorAll<HTMLElement>('pre')) {
    const code = pre.querySelector('code')
    if (!code || code.classList.contains('language-mermaid') || pre.querySelector('.yy-copy')) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'yy-copy'
    button.textContent = '复制'
    button.addEventListener('click', async () => {
      button.textContent = (await copyText(code.textContent ?? '')) ? '已复制' : '复制失败'
      setTimeout(() => (button.textContent = '复制'), 1500)
    })
    pre.appendChild(button)
  }
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
