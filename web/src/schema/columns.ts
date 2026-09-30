import { Node } from '@tiptap/core'

// Widths are positive integer weights, not pixels. null means equal columns.
export function columnWidths(value: unknown, count: number): number[] | null {
  return Array.isArray(value) && value.length === count && value.every(w => Number.isInteger(w) && w >= 1 && w <= 1000) ? [...value] : null
}
export function columnGrid(value: unknown, count: number): string {
  return (columnWidths(value, count) ?? Array(count).fill(1)).map(w => `minmax(0, ${w}fr)`).join(' ')
}
const columnBody = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > [data-columns-content]') ?? el
export const Columns = Node.create({
  name: 'columns', group: 'block', content: 'column{2,4}', defining: true, isolating: true,
  addAttributes() {
    return { widths: { default: null, rendered: false, parseHTML: el => {
      const value = el.getAttribute('data-column-widths')
      return value ? columnWidths(value.split(',').map(Number), columnBody(el).querySelectorAll(':scope > [data-column]').length) : null
    } } }
  },
  parseHTML() { return [{ tag: 'div[data-columns]', contentElement: columnBody }] },
  renderHTML({ node }) {
    const widths = columnWidths(node.attrs.widths, node.childCount)
    return ['div', { class: 'yy-columns', 'data-columns': '', ...(widths ? { 'data-column-widths': widths.join(',') } : {}),
      style: `display: grid; grid-template-columns: ${columnGrid(widths, node.childCount)}; gap: 24px` }, 0]
  },
})
export const Column = Node.create({
  name: 'column', content: 'block+', defining: true, isolating: true, selectable: false,
  parseHTML() { return [{ tag: 'div[data-column]' }] },
  renderHTML() { return ['div', { class: 'yy-column', 'data-column': '', style: 'min-width: 0' }, 0] },
})
