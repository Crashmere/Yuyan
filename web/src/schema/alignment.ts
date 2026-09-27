import { Extension, type Node } from '@tiptap/core'

export type Alignment = 'left' | 'center' | 'right'

export function alignment(value: unknown): Alignment | null {
  return value === 'left' || value === 'center' || value === 'right' ? value : null
}

// Images remain inline until explicitly aligned; an aligned image occupies its own line.
export function blockAlignment(value: unknown, image = false): Record<string, string> {
  const align = alignment(value)
  if (!align) return {}
  return {
    'data-align': align,
    style: `${image ? 'display: block; ' : ''}margin-left: ${align === 'left' ? '0' : 'auto'}; margin-right: ${align === 'right' ? '0' : 'auto'}`,
  }
}

export const AlignmentAttributes = Extension.create({
  name: 'alignmentAttributes',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => alignment(el.style.textAlign),
            renderHTML: (attrs: Record<string, unknown>) => alignment(attrs.textAlign) ? { style: `text-align: ${attrs.textAlign}` } : {},
          },
        },
      },
      {
        types: ['image', 'table'],
        attributes: {
          blockAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => alignment(el.getAttribute('data-align')),
            // The two nodes render this themselves (images also need display:block).
            rendered: false,
          },
        },
      },
    ]
  },
})

// Keep the Markdown column alignment and the local cell override separate. The data attributes
// let HTML exports recover both; plain HTML readers use the effective text-align style.
export function withCellAlignment<T extends Node>(base: T) {
  return base.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        align: {
          default: null,
          parseHTML: (el: HTMLElement) => alignment(el.hasAttribute('data-column-align') ? el.getAttribute('data-column-align') : el.style.textAlign || el.getAttribute('align')),
          renderHTML: (attrs: Record<string, unknown>) => {
            const column = alignment(attrs.align)
            const cell = alignment(attrs.cellAlign)
            return {
              ...(cell || column ? { style: `text-align: ${cell ?? column}` } : {}),
              ...(cell ? { 'data-cell-align': cell, 'data-column-align': column ?? '' } : {}),
            }
          },
        },
        cellAlign: {
          default: null,
          parseHTML: (el: HTMLElement) => alignment(el.getAttribute('data-cell-align')),
          rendered: false,
        },
      }
    },
  })
}
