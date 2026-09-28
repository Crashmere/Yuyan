// Image neighbors may have user-authored spaces or explicit line breaks between them.
// Those remain document content; automatic spacing is only a view decoration.
export function imagePairs<T>(items: T[], kind: (item: T) => 'image' | 'space' | 'break' | 'other') {
  const pairs: { before: T; after: T; lineBreak: boolean }[] = []
  let before: T | null = null
  let lineBreak = false
  for (const item of items) {
    const type = kind(item)
    if (type === 'image') {
      if (before) pairs.push({ before, after: item, lineBreak })
      before = item
      lineBreak = false
    } else if (type === 'break') lineBreak = true
    else if (type !== 'space') { before = null; lineBreak = false }
  }
  return pairs
}

export function imageGap(): HTMLSpanElement {
  const gap = document.createElement('span')
  gap.className = 'yy-image-gap'
  gap.setAttribute('aria-hidden', 'true')
  gap.contentEditable = 'false'
  return gap
}

// Reading HTML keeps the Go renderer's document structure. Marked/linked images use the same
// flow rules as plain images, without treating emphasis or links as separate image groups.
export function enhanceImageFlow(root: HTMLElement) {
  root.querySelectorAll('.yy-image-gap').forEach(gap => gap.remove())
  root.querySelectorAll('.yy-image-run').forEach(image => image.classList.remove('yy-image-run', 'yy-image-run-next'))
  for (const block of root.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, .callout-title')) {
    if (!block.querySelector('img')) continue
    const items: Node[] = []
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE || node instanceof HTMLImageElement || node instanceof HTMLBRElement) items.push(node)
      else node.childNodes.forEach(walk)
    }
    block.childNodes.forEach(walk)
    for (const { before, after, lineBreak } of imagePairs(items, node => node instanceof HTMLImageElement ? 'image' : node instanceof HTMLBRElement ? 'break' : /^[\s\u00a0]*$/.test(node.textContent ?? '') ? 'space' : 'other')) {
      const a = before as HTMLImageElement, b = after as HTMLImageElement
      a.classList.add('yy-image-run', 'yy-image-run-next')
      b.classList.add('yy-image-run')
      if (!lineBreak && !a.hasAttribute('data-align') && !b.hasAttribute('data-align')) a.after(imageGap())
    }
  }
}
