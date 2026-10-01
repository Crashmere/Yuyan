import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { internalTarget, previewLink } from './internalLinks'

// Delegation also covers newly inserted editor links. Keep the preview outside ProseMirror's
// DOM and render plain text only; hovering never changes the editor selection.
export function setupLinkPreviews(root: HTMLElement): () => void {
  let target: HTMLElement | null = null, card: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  function clear() {
    generation++; clearTimeout(timer); card?.remove(); card = null; target = null
  }
  function over(event: PointerEvent) {
    if (event.pointerType === 'touch') return
    const el = (event.target as Element).closest<HTMLElement>('a[href], [data-preview-href]')
    const href = el?.getAttribute('data-preview-href') ?? el?.getAttribute('href') ?? ''
    if (!el || !internalTarget(href) || el === target) return
    clear(); target = el
    const version = generation
    timer = setTimeout(async () => {
      let preview
      try { preview = await previewLink(href) } catch { preview = null }
      if (version !== generation || !el.isConnected) return
      card = document.createElement('div'); card.className = 'yy-link-preview'; card.setAttribute('role', 'tooltip')
      const title = document.createElement('strong'), detail = document.createElement('small'), body = document.createElement('p')
      title.textContent = preview?.heading || preview?.title || '链接目标不存在'
      detail.textContent = preview ? `${preview.bookName}${preview.heading ? ` · ${preview.title}` : ''}` : '文档或章节可能已删除或改名'
      body.textContent = preview?.snippet || (preview ? '暂无文字内容' : '')
      card.append(title, detail, body); document.body.append(card)
      const node = card
      const pos = await computePosition(el, node, { strategy: 'fixed', placement: 'top-start', middleware: [offset(8), flip(), shift({ padding: 10 })] })
      if (node.isConnected) Object.assign(node.style, { left: `${pos.x}px`, top: `${pos.y}px` })
    }, 420)
  }
  function out(event: PointerEvent) { if (target && !target.contains(event.relatedTarget as Node | null)) clear() }
  root.addEventListener('pointerover', over); root.addEventListener('pointerout', out)
  root.addEventListener('pointerdown', clear); window.addEventListener('scroll', clear, true)
  return () => {
    clear(); root.removeEventListener('pointerover', over); root.removeEventListener('pointerout', out)
    root.removeEventListener('pointerdown', clear); window.removeEventListener('scroll', clear, true)
  }
}
