import { Extension, Mark } from '@tiptap/core'

export const colors = [
  { label: '灰色', text: '#666666', textDark: '#b8b8b8', background: '#eeeeee', backgroundDark: '#36383d' },
  { label: '红色', text: '#c03939', textDark: '#f18d8d', background: '#fbe4e4', backgroundDark: '#512e34' },
  { label: '橙色', text: '#b86217', textDark: '#efb16f', background: '#faead8', backgroundDark: '#4c3928' },
  { label: '黄色', text: '#957319', textDark: '#dfc56f', background: '#faf0c9', backgroundDark: '#464024' },
  { label: '绿色', text: '#27804b', textDark: '#79c69a', background: '#e1f2e7', backgroundDark: '#263f32' },
  { label: '青色', text: '#247c87', textDark: '#78c7d2', background: '#dff1f4', backgroundDark: '#263d44' },
  { label: '蓝色', text: '#3264c8', textDark: '#8bb1f5', background: '#e5edfb', backgroundDark: '#2b3650' },
  { label: '紫色', text: '#8450b5', textDark: '#c6a0e9', background: '#efe5f8', backgroundDark: '#3e3050' },
] as const

// Store solid colours only; arbitrary CSS never reaches the renderer.
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map(c => c + c).join('')
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*1(?:\.0*)?)?\s*\)$/.exec(v)
  if (rgb && rgb.slice(1).every(n => Number(n) <= 255)) return '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('')
  const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff', teal: '#008080', navy: '#000080' }
  return named[v] ?? null
}

export type ColorKind = 'text' | 'background'
export function colorAttributes(value: unknown, kind: ColorKind): Record<string, string> {
  const color = normalizeColor(value)
  if (!color) return {}
  const preset = colors.find(c => c[kind] === color)
  const property = kind === 'text' ? 'color' : 'background-color'
  const dark = preset?.[kind === 'text' ? 'textDark' : 'backgroundDark']
  return {
    [kind === 'text' ? 'data-text-color' : 'data-cell-background']: color,
    style: `${property}: ${color}${dark ? `; ${property}: light-dark(${color}, ${dark})` : ''}`,
  }
}

export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return { color: { default: null, parseHTML: (el: HTMLElement) => normalizeColor(el.getAttribute('data-text-color') || el.style.color), rendered: false } }
  },
  parseHTML() {
    return [
      { tag: 'span[data-text-color]', getAttrs: el => normalizeColor(el.getAttribute('data-text-color')) ? null : false },
      { style: 'color', getAttrs: value => { const color = normalizeColor(value); return color ? { color } : false } },
    ]
  },
  renderHTML({ mark }) { return ['span', colorAttributes(mark.attrs.color, 'text'), 0] },
})

export const CellBackground = Extension.create({
  name: 'cellBackground',
  addGlobalAttributes() {
    return [{ types: ['tableCell', 'tableHeader'], attributes: {
      backgroundColor: {
        default: null,
        parseHTML: (el: HTMLElement) => normalizeColor(el.getAttribute('data-cell-background') || el.style.backgroundColor),
        renderHTML: attrs => colorAttributes(attrs.backgroundColor, 'background'),
      },
    } }]
  },
})
