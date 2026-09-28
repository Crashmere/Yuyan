import type { Editor } from '@tiptap/core'
import { blockWidth } from './images'
import { commitSelectionChange, selectionContent, type SelectedNode } from './selectionContent'

export const imageSizes = [
  { label: '原始尺寸', fraction: 0 },
  { label: '适应宽度', fraction: 1 },
  { label: '75%', fraction: 0.75 },
  { label: '50%', fraction: 0.5 },
  { label: '25%', fraction: 0.25 },
]

export function imageSizeLabel(images: SelectedNode[]): string {
  const first = images[0]?.node.attrs
  if (!first) return '图片尺寸'
  if (images.some(({ node }) => node.attrs.width !== first.width || node.attrs.height !== first.height)) return '多种尺寸'
  if (first.width) return `${first.width} px`
  return first.height ? `高度 ${first.height} px` : '原始尺寸'
}

export function updateSelectedImages(e: Editor, attrs: Record<string, unknown> | ((image: SelectedNode) => Record<string, unknown>)) {
  const tr = e.state.tr
  for (const image of selectionContent(e.state).images) {
    const changes = typeof attrs === 'function' ? attrs(image) : attrs
    if (Object.entries(changes).some(([key, value]) => image.node.attrs[key] !== value)) {
      tr.setNodeMarkup(image.pos, undefined, { ...image.node.attrs, ...changes })
    }
  }
  commitSelectionChange(e, tr)
}

export function resizeSelectedImages(e: Editor, fraction: number) {
  updateSelectedImages(e, ({ pos }) => {
    if (!fraction) return { width: null, height: null }
    const dom = e.view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return {}
    // Each image uses its own available width (e.g. a table cell or a nested list).
    return { width: Math.max(24, Math.round(blockWidth(dom) * fraction)), height: null }
  })
}
