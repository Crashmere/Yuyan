import { Extension, Mark } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'

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

// A named gradient always has a solid fallback; documents never contain arbitrary gradient CSS.
export const textGradients = [
  { id: 'ocean', label: '青蓝渐变', from: '#14b8a6', to: '#2563eb' },
  { id: 'violet', label: '蓝紫渐变', from: '#2563eb', to: '#c026d3' },
  { id: 'sunset', label: '粉橙渐变', from: '#ec4899', to: '#f97316' },
  { id: 'flame', label: '橙红渐变', from: '#f59e0b', to: '#dc2626' },
] as const
export function textGradient(value: unknown) { return textGradients.find(g => g.id === value) }
export function gradientPaint(value: unknown): string | null {
  const g = textGradient(value)
  return g ? `linear-gradient(90deg, ${g.from}, ${g.to})` : null
}
export function textColorValue(attrs: Record<string, unknown>): string | null {
  const g = textGradient(attrs.gradient)
  return g ? `gradient:${g.id}` : normalizeColor(attrs.color)
}
export function textColorAttrs(value: string): Record<string, string | null> {
  const g = textGradient(value.replace(/^gradient:/, ''))
  return { color: g?.from ?? normalizeColor(value), gradient: g?.id ?? null }
}
export function textColorAttributes(attrs: Record<string, unknown>): Record<string, string> {
  const base = colorAttributes(attrs.color, 'text'), g = textGradient(attrs.gradient)
  if (!g) return base
  return { ...base, 'data-text-gradient': g.id, style: `color: ${g.from}; background-image: ${gradientPaint(g.id)}; background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent` }
}

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

export type ColorKind = 'text' | 'background' | 'highlight'
export function colorAttributes(value: unknown, kind: ColorKind): Record<string, string> {
  const color = normalizeColor(value)
  if (!color) return {}
  const preset = colors.find(c => c[kind === 'text' ? 'text' : 'background'] === color)
  const property = kind === 'text' ? 'color' : 'background-color'
  const dark = preset?.[kind === 'text' ? 'textDark' : 'backgroundDark'] ?? (kind !== 'text' && color === '#fff3a3' ? '#5e5200' : null)
  return {
    [kind === 'text' ? 'data-text-color' : kind === 'highlight' ? 'data-highlight-color' : 'data-cell-background']: color,
    style: `${property}: ${color}${dark ? `; ${property}: light-dark(${color}, ${dark})` : ''}`,
  }
}

export const TextColor = Mark.create({
  name: 'textColor',
  // The colour belongs closest to the text, inside links and coloured highlights.
  priority: 90,
  addAttributes() {
    return {
      color: { default: null, parseHTML: (el: HTMLElement) => normalizeColor(el.getAttribute('data-text-color') || el.style.color), rendered: false },
      gradient: { default: null, parseHTML: (el: HTMLElement) => textGradient(el.getAttribute('data-text-gradient'))?.id ?? null, rendered: false },
    }
  },
  parseHTML() {
    return [
      { tag: 'span[data-text-color]', getAttrs: el => normalizeColor(el.getAttribute('data-text-color')) ? null : false },
      { style: 'color', getAttrs: value => { const color = normalizeColor(value); return color ? { color } : false } },
    ]
  },
  renderHTML({ mark }) { return ['span', textColorAttributes(mark.attrs), 0] },
})

// Uncoloured <mark> and ==highlight== keep their original default yellow and Markdown syntax.
export const TextHighlight = Highlight.extend({
  addAttributes() {
    return { color: {
      default: null,
      parseHTML: (el: HTMLElement) => normalizeColor(el.getAttribute('data-highlight-color') || el.getAttribute('data-color') || el.style.backgroundColor),
      renderHTML: attrs => colorAttributes(attrs.color, 'highlight'),
    } }
  },
  parseHTML() {
    return [
      { tag: 'mark' },
      { tag: 'span', getAttrs: el => normalizeColor(el.getAttribute('data-highlight-color') || el.style.backgroundColor) ? null : false },
    ]
  },
}).configure({ multicolor: true })

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
