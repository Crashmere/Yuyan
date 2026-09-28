import { Node, mergeAttributes } from '@tiptap/core'
import { alignment, blockAlignment } from './alignment'
import { positive } from './imageGeometry'

export const ImageBoard = Node.create({
  name: 'imageBoard', group: 'block', content: 'image+', atom: true, isolating: true, draggable: true,
  addAttributes() {
    return {
      width: { default: 800, parseHTML: (el: HTMLElement) => positive(Number(el.getAttribute('data-width')), 800), rendered: false },
      height: { default: 500, parseHTML: (el: HTMLElement) => positive(Number(el.getAttribute('data-height')), 500), rendered: false },
      blockAlign: { default: null, parseHTML: (el: HTMLElement) => alignment(el.getAttribute('data-align')), rendered: false },
    }
  },
  parseHTML() { return [{ tag: 'div[data-image-board]', contentElement: '[data-board-plane]' }] },
  renderHTML({ node }) {
    const width = positive(node.attrs.width, 800), height = positive(node.attrs.height, 500)
    return ['div', mergeAttributes({ 'data-image-board': '', 'data-width': width, 'data-height': height, style: `width: ${width}px; max-width: 100%` }, blockAlignment(node.attrs.blockAlign)),
      ['div', { 'data-board-plane': '', style: `position: relative; width: 100%; aspect-ratio: ${width} / ${height}; overflow: hidden` }, 0]]
  },
})
