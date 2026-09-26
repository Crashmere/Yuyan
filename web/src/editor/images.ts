// The width an image can take in the block holding it, without the block's padding.
export function blockWidth(el: HTMLElement): number {
  const block = el.closest<HTMLElement>('p, li, td, th, .callout-content, .ProseMirror')
  if (!block) return el.getBoundingClientRect().width
  const style = getComputedStyle(block)
  return Math.floor(block.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
}

export function fileName(src: string): string {
  return decodeURIComponent(src.split('/').pop()?.split('?')[0] || 'image')
}
