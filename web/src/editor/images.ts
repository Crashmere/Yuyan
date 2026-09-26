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
  const style = getComputedStyle(block)
  return Math.floor(block.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
}

export function fileName(src: string): string {
  return decodeURIComponent(src.split('/').pop()?.split('?')[0] || 'image')
}
