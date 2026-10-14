import type { Heading, ImageSizes, Segments } from '../../shared/api'
import { virtualBlocks } from './folds'

// Where the segments of a long document come from (DESIGN 26.2).
export interface SegmentSource extends Segments {
  toc: Heading[]
  load(from: number, to: number): Promise<{ html: string; images: ImageSizes }>
  matches(query: string): Promise<number[]>
}

// Adds a placeholder for each segment after the first, which root holds, before the page is
// first drawn: the page then has about its full height, and folds and reading positions count
// the blocks each one stands for. Heights are estimated from the first segment as drawn.
export function placeSegments(root: HTMLElement, source: SegmentSource): HTMLElement[] {
  const images = [...root.querySelectorAll('img')].map(img => img.getBoundingClientRect().height)
  const imageHeight = images.reduce((sum, h) => sum + h, 0)
  const perImage = images.length ? imageHeight / images.length : 240
  const perByte = Math.min(1, Math.max(0.01, (root.getBoundingClientRect().height - imageHeight) / source.items[0].bytes))
  return source.items.slice(1).map((item, i) => {
    const el = document.createElement('div')
    el.className = 'yy-segment'
    el.dataset.segment = String(i + 1)
    el.setAttribute('aria-hidden', 'true')
    el.style.height = `${Math.round(item.bytes * perByte + item.images * perImage)}px`
    virtualBlocks.set(el, {
      count: item.blocks,
      headings: (item.heads ?? []).map(([block, level, ref, foldable]) => ({
        block, level, id: typeof ref === 'number' ? source.toc[ref]?.id ?? '' : ref, foldable: foldable === 1,
      })),
    })
    root.append(el)
    return el
  })
}
