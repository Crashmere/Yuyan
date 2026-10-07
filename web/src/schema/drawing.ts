import { Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

export const drawingSource = /^\/drawings\/([0-9a-f]{32})$/
export function drawingPreview(src: string, mime = 'image/svg+xml'): string {
  return drawingSource.test(src) ? `${src}/preview` : src.replace(/\.yuyan\.json$/, mime === 'image/png' ? '.png' : '.svg')
}
export function drawingStyle(attrs: Record<string, any>): string {
  const width = Math.max(100, Math.min(2400, Number(attrs.width) || 800))
  const margin = attrs.blockAlign === 'left' ? '0 auto 0 0' : attrs.blockAlign === 'right' ? '0 0 0 auto' : '0 auto'
  return `width: ${width}px; max-width: 100%; margin: ${margin}`
}
export const Drawing = Node.create({
  name: 'drawing', group: 'block', atom: true, draggable: true,
  addOptions() { return { resolveSrc: (src: string) => src, unresolveSrc: (src: string) => src } },
  addAttributes() {
    return {
      src: { default: '', parseHTML: el => this.options.unresolveSrc(el.getAttribute('data-src') ?? '') },
      version: { default: 1, parseHTML: el => Number(el.getAttribute('data-drawing')) || 1 },
      width: { default: 800, parseHTML: el => Number(el.getAttribute('data-width')) || 800 },
      blockAlign: { default: 'center', parseHTML: el => el.getAttribute('data-align') || 'center' },
      caption: { default: '', parseHTML: el => el.getAttribute('data-caption') || '' },
      text: { default: '', parseHTML: el => el.getAttribute('data-text') || '' },
      previewWidth: { default: 1, parseHTML: el => Number(el.getAttribute('data-preview-width')) || 1 },
      previewHeight: { default: 1, parseHTML: el => Number(el.getAttribute('data-preview-height')) || 1 },
      previewMime: { default: 'image/svg+xml', parseHTML: el => el.getAttribute('data-preview-mime') || 'image/svg+xml' },
    }
  },
  parseHTML() { return [{ tag: 'figure[data-drawing]' }] },
  renderText({ node }) { return [node.attrs.text, node.attrs.caption].filter(Boolean).join('\n') },
  renderHTML({ node }): DOMOutputSpec {
    const a = node.attrs
    return ['figure', {
      'data-drawing': a.version, 'data-src': this.options.resolveSrc(a.src), 'data-width': a.width, 'data-align': a.blockAlign,
      'data-caption': a.caption, 'data-text': a.text, 'data-preview-width': a.previewWidth, 'data-preview-height': a.previewHeight,
      'data-preview-mime': a.previewMime, class: 'yy-drawing', style: drawingStyle(a),
    },
    ['img', { src: this.options.resolveSrc(drawingPreview(a.src, a.previewMime)), width: a.previewWidth, height: a.previewHeight, alt: a.caption || '画板', loading: 'lazy', style: 'width: 100%; max-width: 100%; height: auto' }],
    ['figcaption', {}, a.caption],
    ['span', { class: 'yy-drawing-text', hidden: '' }, a.text],
    ['a', { class: 'yy-drawing-source', href: this.options.resolveSrc(drawingSource.test(a.src) ? `${a.src}/file` : a.src), download: 'drawing.yuyan.json' }, '画板源文件']]
  },
})
