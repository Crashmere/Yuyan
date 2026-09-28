import { Extension, type Editor } from '@tiptap/core'
import type { ImageSizes } from '../shared/api'

// The pixel sizes of the document's uploaded images, from the server and from uploads made while
// editing; image node views use them to keep their space before the images load.
export const ImageSizeStore = Extension.create<unknown, { sizes: ImageSizes }>({
  name: 'imageSizes',
  addStorage: () => ({ sizes: {} }),
})

export function imageSizes(editor: Editor): ImageSizes {
  return (editor.storage as unknown as { imageSizes: { sizes: ImageSizes } }).imageSizes.sizes
}

// The width an image can take in the block holding it, without the block's padding.
export function blockWidth(el: HTMLElement): number {
  const block = el.closest<HTMLElement>('p, li, td, th, .callout-content, .ProseMirror')
  if (!block) return el.getBoundingClientRect().width
  // A selected image may live in a collapsed Callout. Use the nearest measurable ancestor,
  // subtracting the hidden containers' insets, instead of writing a zero-width batch resize.
  let inset = 0
  for (let current: HTMLElement | null = block; current; current = current.parentElement) {
    const style = getComputedStyle(current)
    inset += parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    if (current.clientWidth > 0) return Math.max(0, Math.floor(current.clientWidth - inset))
    inset += (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0)
  }
  return 0
}

export function fileName(src: string): string {
  return decodeURIComponent(src.split('/').pop()?.split('?')[0] || 'image')
}
