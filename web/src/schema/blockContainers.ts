import { Node } from '@tiptap/core'

export const blockColors = [
  { label: '灰色', value: '#f0f1f2', dark: '#343638', swatch: '#d8dada' },
  { label: '蓝色', value: '#e1efff', dark: '#263b52', swatch: '#bbdcff' },
  { label: '青色', value: '#def7fa', dark: '#233e44', swatch: '#b1edf2' },
  { label: '薄荷', value: '#e2f5ed', dark: '#263f37', swatch: '#c0efdf' },
  { label: '绿色', value: '#edf6dc', dark: '#354026', swatch: '#d9efb1' },
  { label: '黄色', value: '#fff3d8', dark: '#473d25', swatch: '#f7e1aa' },
  { label: '橙色', value: '#feebdf', dark: '#49372d', swatch: '#f8d4b8' },
  { label: '红色', value: '#fce6e8', dark: '#482f35', swatch: '#f8cbd0' },
  { label: '粉色', value: '#fbe5f2', dark: '#452e40', swatch: '#f5bfdf' },
  { label: '紫色', value: '#eee7fb', dark: '#39304c', swatch: '#d7c6f6' },
] as const

export const blockColor = (value: unknown) => blockColors.find(c => c.value === value) ?? blockColors[1]
export function highlightBlockAttrs(value: unknown): Record<string, string> {
  const color = blockColor(value)
  return { class: 'yy-highlight-block', 'data-highlight-block': color.value,
    style: `background-color: ${color.value}; background-color: light-dark(${color.value}, ${color.dark})` }
}

export const FoldBlock = Node.create({
  name: 'foldBlock', group: 'block', content: 'foldTitle foldContent', defining: true, isolating: true,
  addAttributes() {
    return { collapsed: { default: false, parseHTML: el => !el.hasAttribute('open'), rendered: false } }
  },
  parseHTML() { return [{ tag: 'details[data-fold-block]' }] },
  renderHTML({ node }) {
    return ['details', { class: 'yy-fold-block', 'data-fold-block': '', ...(node.attrs.collapsed ? {} : { open: '' }) }, 0]
  },
})
export const FoldTitle = Node.create({
  name: 'foldTitle', content: 'inline*', defining: true,
  parseHTML() { return [{ tag: 'summary', context: 'foldBlock/' }] },
  renderHTML() { return ['summary', { class: 'yy-fold-title' }, 0] },
})
export const FoldContent = Node.create({
  name: 'foldContent', content: 'block+', defining: true,
  parseHTML() { return [{ tag: 'div[data-fold-content]' }] },
  renderHTML() { return ['div', { class: 'yy-fold-content', 'data-fold-content': '' }, 0] },
})
export const HighlightBlock = Node.create({
  name: 'highlightBlock', group: 'block', content: 'block+', defining: true, isolating: true,
  addAttributes() {
    return { backgroundColor: {
      default: blockColors[1].value,
      parseHTML: el => blockColor(el.getAttribute('data-highlight-block')).value,
      rendered: false,
    } }
  },
  parseHTML() { return [{ tag: 'div[data-highlight-block]' }] },
  renderHTML({ node }) { return ['div', highlightBlockAttrs(node.attrs.backgroundColor), 0] },
})
