// Fractions are relative to the original image (crop) or the board (placement).
// Original files are immutable; these small values are all that crop/split needs to save.
export interface ImageRect { x: number; y: number; width: number; height: number }
export const fullImage: ImageRect = { x: 0, y: 0, width: 1, height: 1 }
export const round = (n: number) => Math.round(n * 1e6) / 1e6
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export function rect(value: unknown, crop = false): ImageRect | null {
  if (!value || typeof value !== 'object') return null
  const a = value as ImageRect
  if (![a.x, a.y, a.width, a.height].every((n) => typeof n === 'number' && Number.isFinite(n)) || a.width <= 0 || a.height <= 0) return null
  const x = clamp(a.x, 0, crop ? 0.999999 : 1e6), y = clamp(a.y, 0, crop ? 0.999999 : 1e6)
  return { x: round(x), y: round(y), width: round(clamp(a.width, 0.000001, crop ? 1 - x : 1e6)), height: round(clamp(a.height, 0.000001, crop ? 1 - y : 1e6)) }
}
export function cropRect(value: unknown): ImageRect { return rect(value, true) ?? { ...fullImage } }
export function storedCrop(value: unknown): ImageRect | null {
  const r = cropRect(value)
  return r.x === 0 && r.y === 0 && r.width === 1 && r.height === 1 ? null : r
}
export function parseRect(value: string | null, crop = false): ImageRect | null {
  const [x, y, width, height] = (value ?? '').split(',').map(Number)
  return rect({ x, y, width, height }, crop)
}
export const rectText = (r: ImageRect) => [r.x, r.y, r.width, r.height].join(',')
export const positive = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback
export function imageDimensions(attrs: Record<string, any>, natural?: [number, number]) {
  const crop = cropRect(attrs.crop)
  const sourceWidth = positive(attrs.sourceWidth, natural?.[0] || 320), sourceHeight = positive(attrs.sourceHeight, natural?.[1] || 240)
  const ratio = sourceWidth * crop.width / (sourceHeight * crop.height)
  const width = positive(attrs.width, attrs.height ? positive(attrs.height, 1) * ratio : sourceWidth * crop.width)
  const height = positive(attrs.height, width / ratio)
  return { width, height, sourceWidth, sourceHeight, ratio }
}
export function cropImageStyle(value: unknown): string {
  const c = cropRect(value)
  return `position: absolute; left: ${round(-c.x / c.width * 100)}%; top: ${round(-c.y / c.height * 100)}%; width: ${round(100 / c.width)}% !important; height: ${round(100 / c.height)}% !important; max-width: none !important; margin: 0; border-radius: 0; display: block`
}
export function imageFrameStyle(attrs: Record<string, any>, natural?: [number, number]): string {
  const p = rect(attrs.placement), d = imageDimensions(attrs, natural)
  const geometry = p
    ? `position: absolute; left: ${round(p.x * 100)}%; top: ${round(p.y * 100)}%; width: ${round(p.width * 100)}%; height: ${round(p.height * 100)}%`
    : `position: relative; width: ${round(d.width)}px; aspect-ratio: ${round(d.width)} / ${round(d.height)}; max-width: 100%`
  return `display: inline-block; overflow: hidden; vertical-align: middle; border-radius: 4px; line-height: 0; ${geometry}`
}
export function splitRects(value: unknown, axis: 'horizontal' | 'vertical', parts: number, first = 0.5): ImageRect[] {
  const crop = cropRect(value), count = Math.round(clamp(parts, 2, 8))
  const edges = count === 2 ? [0, clamp(first, 0.05, 0.95), 1] : Array.from({ length: count + 1 }, (_, i) => i / count)
  return edges.slice(0, -1).map((start, i) => axis === 'vertical'
    ? { ...crop, x: round(crop.x + crop.width * start), width: round(crop.width * (edges[i + 1] - start)) }
    : { ...crop, y: round(crop.y + crop.height * start), height: round(crop.height * (edges[i + 1] - start)) })
}
