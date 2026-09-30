import type { DOMOutputSpec } from '@tiptap/pm/model'
import { alignment } from './alignment'
import { rect, round } from './imageGeometry'

export const captionTextStyle = 'display: block; width: 0; min-width: 100%; padding-top: 6px; font-size: 12px; line-height: 1.5; font-weight: normal; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; color: light-dark(#8a8f8d, #85888c)'
export function captionBoxStyle(attrs: Record<string, any>): string {
  const p = rect(attrs.placement), align = alignment(attrs.blockAlign)
  const base = 'display: inline-block; max-width: 100%; vertical-align: top; line-height: 0'
  if (p) return `${base}; position: absolute; left: ${round(p.x * 100)}%; top: ${round(p.y * 100)}%; width: ${round(p.width * 100)}%; height: ${round(p.height * 100)}%`
  if (align) return `${base}; display: block; width: fit-content; margin-left: ${align === 'left' ? '0' : 'auto'}; margin-right: ${align === 'right' ? '0' : 'auto'}`
  return base
}
export function withImageCaption(image: DOMOutputSpec, attrs: Record<string, any>): DOMOutputSpec {
  const caption = typeof attrs.caption === 'string' ? attrs.caption : ''
  if (!caption) return image
  return ['span', { 'data-image-caption': '', 'data-caption': caption, style: captionBoxStyle(attrs) }, image,
    ['span', { 'data-caption-text': '', style: captionTextStyle + (rect(attrs.placement) ? '; position: absolute; left: 0; top: 100%' : '') }, caption]]
}
export function imageElement(el: HTMLElement): HTMLElement { return el.matches('[data-image-caption]') ? el.querySelector('img') ?? el : el }
