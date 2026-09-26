import { copyText } from '../shared/clipboard'
import { needsDisplay } from '../shared/latex'
import { renderMermaid } from '../shared/mermaid'

export function enhanceContent(root: ParentNode = document) {
  setupCalloutFolding(root)
  addCopyButtons(root)
  void renderMath(root)
  void renderDiagrams(root)
  trackToc()
}

function setupCalloutFolding(root: ParentNode) {
  root.addEventListener('click', (e) => {
    const title = (e.target as HTMLElement).closest('.callout[data-callout-fold] > .callout-title')
    if (title) title.parentElement?.classList.toggle('is-collapsed')
  })
}

async function renderMath(root: ParentNode) {
  const nodes = root.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]')
  if (!nodes.length) return
  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
  for (const el of nodes) {
    const latex = el.dataset.latex ?? ''
    katex.render(latex, el, { displayMode: el.dataset.type === 'block-math' || needsDisplay(latex), throwOnError: false })
  }
}

async function renderDiagrams(root: ParentNode) {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
    const pre = code.parentElement!
    try {
      const box = document.createElement('div')
      box.className = 'yy-mermaid'
      box.innerHTML = await renderMermaid(code.textContent ?? '')
      pre.replaceWith(box)
    } catch (e) {
      pre.insertAdjacentHTML('afterend', `<p class="yy-mermaid-error">图表渲染失败，显示原始代码。</p>`)
      console.warn('mermaid', e)
    }
  }
}

function addCopyButtons(root: ParentNode) {
  for (const pre of root.querySelectorAll<HTMLElement>('.yy-content pre')) {
    const code = pre.querySelector('code')
    if (!code || code.classList.contains('language-mermaid')) continue
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

// Highlights the table-of-contents entry for the heading currently at the top of the page.
function trackToc() {
  const links = new Map<string, HTMLAnchorElement>()
  document.querySelectorAll<HTMLAnchorElement>('.yy-toc a[href^="#"]').forEach((a) => links.set(decodeURIComponent(a.hash.slice(1)), a))
  if (!links.size) return
  let active: HTMLAnchorElement | undefined
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        active?.classList.remove('active')
        active = links.get(entry.target.id)
        active?.classList.add('active')
      }
    },
    { rootMargin: '0px 0px -75% 0px' },
  )
  for (const id of links.keys()) {
    const heading = document.getElementById(id)
    if (heading) observer.observe(heading)
  }
}
