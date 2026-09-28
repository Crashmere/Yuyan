import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { assetId } from '../shared/images'
import { cropRect, imageDimensions, rect, round, splitRects, storedCrop, type ImageRect } from '../schema/imageGeometry'
import { imageSizes, blockWidth } from './images'
import { selectionContent } from './selectionContent'

export type ImageScope = 'selection' | 'section' | 'document' | 'board'
export type ImageParameter = 'size' | 'crop' | 'align' | 'shadow'
export type ImageEditMode = 'crop' | 'split' | 'apply'
export interface ImageTarget { pos: number; node: PMNode }
export function imageAt(e: Editor, pos: number): ImageTarget | null {
  const node = e.state.doc.nodeAt(pos)
  return node?.type.name === 'image' ? { pos, node } : null
}
export function sourceAttrs(e: Editor, target: ImageTarget): Record<string, any> {
  const a = target.node.attrs, id = assetId(String(a.src ?? ''))
  const natural = id ? imageSizes(e)[id] : undefined
  const dom = e.view.nodeDOM(target.pos)
  const img = dom instanceof HTMLElement ? dom.querySelector('img') : null
  return { ...a, sourceWidth: a.sourceWidth || natural?.[0] || img?.naturalWidth || 320, sourceHeight: a.sourceHeight || natural?.[1] || img?.naturalHeight || 240 }
}
export function boardAt(e: Editor, pos: number): { pos: number; node: PMNode } | null {
  const $pos = e.state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'imageBoard') return { pos: $pos.before(d), node: $pos.node(d) }
  return null
}
export function sectionAt(e: Editor, pos: number) {
  let from = 0, to = e.state.doc.content.size, level = 0, title = '文档开头'
  const headings: { pos: number; node: PMNode }[] = []
  e.state.doc.descendants((node, at) => { if (node.type.name === 'heading') headings.push({ pos: at, node }); if (node.type.name === 'imageBoard') return false })
  for (const h of headings) {
    if (h.pos < pos) { from = h.pos; level = h.node.attrs.level; title = h.node.textContent || '无文字标题' }
    else if (!level || h.node.attrs.level <= level) { to = h.pos; break }
  }
  return { from, to, title }
}
export function scopeImages(e: Editor, scope: ImageScope, positions: number[], source: number): ImageTarget[] {
  if (scope === 'selection') return positions.flatMap((pos) => { const t = imageAt(e, pos); return t ? [t] : [] })
  const section = sectionAt(e, source), board = boardAt(e, source)
  if (scope === 'board' && !board) return []
  const from = scope === 'section' ? section.from : scope === 'board' ? board!.pos + 1 : 0
  const to = scope === 'section' ? section.to : scope === 'board' ? board!.pos + board!.node.nodeSize - 1 : e.state.doc.content.size
  const out: ImageTarget[] = []
  e.state.doc.nodesBetween(from, to, (node, pos) => { if (node.type.name === 'image') out.push({ node, pos }) })
  return out
}
export function commitImages(e: Editor, targets: ImageTarget[], change: (target: ImageTarget) => Record<string, any>): number {
  if (!e.isEditable) return 0
  const tr = closeHistory(e.state.tr)
  let count = 0
  for (const target of targets) {
    const attrs = { ...target.node.attrs, ...change(target) }
    if (JSON.stringify(attrs) !== JSON.stringify(target.node.attrs)) { tr.setNodeMarkup(target.pos, undefined, attrs); count++ }
  }
  if (count) { tr.setSelection(e.state.selection.getBookmark().resolve(tr.doc)); e.view.dispatch(tr); e.view.dispatch(closeHistory(e.state.tr)) }
  return count
}
export function cropImages(e: Editor, targets: ImageTarget[], value: ImageRect | null) {
  return commitImages(e, targets, (t) => {
    const attrs = sourceAttrs(e, t), old = cropRect(attrs.crop), crop = cropRect(value), d = imageDimensions(attrs)
    const placement = rect(attrs.placement)
    return { sourceWidth: attrs.sourceWidth, sourceHeight: attrs.sourceHeight, crop: storedCrop(value), width: round(d.width * crop.width / old.width), height: attrs.height ? round(d.height * crop.height / old.height) : null,
      ...(placement ? { placement: { ...placement, width: round(placement.width * crop.width / old.width), height: round(placement.height * crop.height / old.height) } } : {}) }
  })
}
export function applyImageParameters(e: Editor, source: ImageTarget, targets: ImageTarget[], params: ImageParameter[]) {
  const a = sourceAttrs(e, source)
  return commitImages(e, targets, (t) => {
    const changes: Record<string, any> = {}, current = sourceAttrs(e, t)
    if (params.includes('size')) Object.assign(changes, { width: a.width ?? null, height: a.height ?? null })
    if (params.includes('crop')) Object.assign(changes, { crop: storedCrop(a.crop), sourceWidth: current.sourceWidth, sourceHeight: current.sourceHeight })
    if (params.includes('align')) changes.blockAlign = a.blockAlign ?? null
    if (params.includes('shadow')) changes.shadow = a.shadow ?? null
    const p = rect(current.placement), board = boardAt(e, t.pos)
    if (p && board && (params.includes('size') || params.includes('crop'))) {
      const d = imageDimensions({ ...current, ...changes })
      changes.placement = { ...p, width: round(d.width / board.node.attrs.width), height: round(d.height / board.node.attrs.height) }
    }
    return changes
  })
}
export function splitImage(e: Editor, target: ImageTarget, axis: 'horizontal' | 'vertical', parts: number, first: number) {
  const attrs = sourceAttrs(e, target), before = cropRect(attrs.crop), d = imageDimensions(attrs), p = rect(attrs.placement)
  const crops = splitRects(attrs.crop, axis, parts, first), nodes: PMNode[] = []
  for (const [i, crop] of crops.entries()) {
    if (i && axis === 'horizontal' && !p) nodes.push(e.schema.nodes.hardBreak.create())
    const width = round(d.width * crop.width / before.width), height = round(d.height * crop.height / before.height)
    nodes.push(target.node.type.create({ ...attrs, crop, width, height: attrs.height ? height : null,
      placement: p ? { x: round(p.x + p.width * (crop.x - before.x) / before.width), y: round(p.y + p.height * (crop.y - before.y) / before.height), width: round(p.width * crop.width / before.width), height: round(p.height * crop.height / before.height) } : null }, undefined, target.node.marks))
  }
  const tr = closeHistory(e.state.tr.replaceWith(target.pos, target.pos + target.node.nodeSize, nodes))
  const board = boardAt(e, target.pos)
  tr.setSelection(NodeSelection.create(tr.doc, board?.pos ?? target.pos))
  e.view.dispatch(tr); e.view.dispatch(closeHistory(e.state.tr))
}

export function gridLayout(attrs: Record<string, any>[], width: number, columns: number, gap: number) {
  const cols = Math.max(1, Math.min(attrs.length, Math.floor(Number(columns) || 1), Math.floor(width / 24)))
  gap = Math.max(0, Math.min(Number(gap) || 0, 100, (width - 24 * cols) / (cols + 1)))
  const cell = Math.max(24, (width - gap * (cols + 1)) / cols)
  const placed: { x: number; y: number; width: number; height: number }[] = []
  let y = gap
  for (let i = 0; i < attrs.length; i += cols) {
    const row = attrs.slice(i, i + cols).map((a) => ({ width: cell, height: cell / imageDimensions(a).ratio }))
    row.forEach((size, j) => placed.push({ x: gap + j * (cell + gap), y, ...size }))
    y += Math.max(...row.map((r) => r.height)) + gap
  }
  const height = Math.max(48, y)
  return { height, attrs: attrs.map((a, i) => ({ ...a, width: round(placed[i].width), height: null, placement: { x: round(placed[i].x / width), y: round(placed[i].y / height), width: round(placed[i].width / width), height: round(placed[i].height / height) } })) }
}
export function groupImages(e: Editor) {
  const targets = selectionContent(e.state).images.filter((t) => !boardAt(e, t.pos))
  if (!targets.length) return false
  const first = targets[0].pos, dom = e.view.nodeDOM(first)
  const width = Math.min(800, Math.max(160, dom instanceof HTMLElement ? blockWidth(dom) : 800))
  const layout = gridLayout(targets.map((t) => sourceAttrs(e, t)), width, Math.min(3, Math.ceil(Math.sqrt(targets.length))), 12)
  const board = e.schema.nodes.imageBoard.create({ width, height: round(layout.height) }, layout.attrs.map((a, i) => targets[i].node.type.create(a, undefined, targets[i].node.marks)))
  const selected = new Set(targets.map((t) => t.pos)), ranges = new Map<number, number>()
  for (const t of targets) {
    const $pos = e.state.doc.resolve(t.pos), parent = $pos.parent, before = $pos.before()
    let only = parent.type.name === 'paragraph'
    parent.forEach((n, offset) => { if (n.type.name === 'image' ? !selected.has(before + 1 + offset) : n.type.name !== 'hardBreak' && (!n.isText || n.text?.trim())) only = false })
    // Remove vacated whole paragraphs only where the enclosing structure permits it.
    const canRemove = $pos.node($pos.depth - 1).canReplace($pos.index($pos.depth - 1), $pos.index($pos.depth - 1) + 1)
    if (only && canRemove) ranges.set(before, before + parent.nodeSize)
    else ranges.set(t.pos, t.pos + t.node.nodeSize)
  }
  const tr = closeHistory(e.state.tr)
  for (const [from, to] of [...ranges].sort((a, b) => b[0] - a[0])) tr.delete(from, to)
  const at = tr.mapping.map(first, -1)
  tr.replaceRangeWith(at, at, board)
  let boardPos = -1
  tr.doc.descendants((n, pos) => { if (n === board) boardPos = pos })
  if (boardPos < 0) return false
  tr.setSelection(NodeSelection.create(tr.doc, boardPos))
  e.view.dispatch(tr.scrollIntoView()); e.view.dispatch(closeHistory(e.state.tr)); return true
}
