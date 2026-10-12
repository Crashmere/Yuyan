import { diffArrays } from 'diff'
import { reveal } from './folds'
import './recentChanges.css'

// Work against the original renderer output. Page controls, line numbers, search
// markers and diagram rendering must never become edits. Live elements are kept by
// DocContent before enhancement so no DOM paths depend on its generated wrappers.
const units = 'p,h1,h2,h3,h4,h5,h6,pre,hr,img,.code-title,.callout-title,.yy-fold-title,[data-type="block-math"],.yy-drawing,[data-attachment],[data-image-board]'
const atomic = 'pre,.yy-drawing,[data-attachment],[data-image-board],[data-type="block-math"]'
const skipped = 'button,.code-lang,.yy-code-gutter,.yy-heading-tools,.yy-drawing-source,.yy-drawing-text'
interface Unit { element: Element; index: number; key: string; kind: string; context: string; text: string; tokens: string[] }
// order is the unit position in the current document: consecutive changes form one patch.
// full means every character is new, so the patch alone marks it.
interface Change { element: Element; spans: [number, number][]; text: string; whole: boolean; order: number; full: boolean }

function attributes(el: Element): string {
  return el.tagName + JSON.stringify([...el.attributes].filter(a => a.name !== 'id').map(a => [a.name, a.value]).sort())
}

function collect(html: string): Unit[] {
  const template = document.createElement('template')
  template.innerHTML = html
  const all = [...template.content.querySelectorAll('*')]
  return all.flatMap((element, index) => {
    if (!element.matches(units) || element.parentElement?.closest(units)) return []
    let context = ''
    for (let p = element.parentElement; p; p = p.parentElement) context += attributes(p)
    const tokens: string[] = []
    let text = ''
    const walk = (node: Node, style: string) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent
        for (const c of node.textContent ?? '') tokens.push(c + '\0' + style)
      } else if (node instanceof Element) {
        if (node.matches(skipped)) return
        if (node.tagName === 'BR') { text += '\n'; tokens.push('\n'); return }
        node.childNodes.forEach(child => walk(child, element.tagName === 'PRE' ? '' : style + attributes(node)))
      }
    }
    walk(element, '')
    const clone = element.cloneNode(true) as Element
    clone.removeAttribute('id')
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
    return [{ element, index, key: clone.outerHTML + context, context, kind: element.tagName + (element.matches(atomic) ? element.getAttribute('class') ?? '' : ''), text, tokens }]
  })
}

// Exact blocks match before edited ones. This preserves unchanged repeated text
// and avoids marking every subsequent paragraph when one is inserted above it.
function compare(before: Unit[], after: Unit[], elements: Element[]): Change[] {
  const matches = after.map(() => -1)
  const used = new Set<number>()
  const match = (key: (u: Unit) => string) => {
    const queues = new Map<string, number[]>()
    before.forEach((u, i) => { if (!used.has(i)) { const k = key(u); const q = queues.get(k) ?? []; q.push(i); queues.set(k, q) } })
    after.forEach((u, j) => {
      if (matches[j] >= 0) return
      const i = queues.get(key(u))?.shift()
      if (i !== undefined) { matches[j] = i; used.add(i) }
    })
  }
  match(u => u.key)
  match(u => u.kind + u.text)
  // Pair similar edits before a wholly new paragraph can consume their baseline.
  const pairingDeadline = Date.now() + 100
  const pairs: { i: number; j: number; score: number }[] = []
  after.forEach((u, j) => {
    if (matches[j] >= 0 || !u.text || Date.now() >= pairingDeadline) return
    before.forEach((v, i) => {
      if (used.has(i) || v.kind !== u.kind || !v.text || Math.abs(i - j) > 12 || Date.now() >= pairingDeadline) return
      const parts = diffArrays([...v.text], [...u.text], { timeout: 4, maxEditLength: 1200 })
      if (!parts) return
      const kept = parts.reduce((n, p) => n + (!p.added && !p.removed ? p.count : 0), 0)
      const score = 2 * kept / ([...u.text].length + [...v.text].length)
      if (score >= 0.5) pairs.push({ i, j, score })
    })
  })
  pairs.sort((a, b) => b.score - a.score).forEach(({ i, j }) => {
    if (!used.has(i) && matches[j] < 0) { used.add(i); matches[j] = i }
  })
  const moved = after.map(() => false)
  let max = -1, min = before.length
  matches.forEach((i, j) => { if (i >= 0) { moved[j] = i < max; max = Math.max(max, i) } })
  for (let j = matches.length - 1; j >= 0; j--) { const i = matches[j]; if (i >= 0) { moved[j] ||= i > min; min = Math.min(min, i) } }
  const deadline = Date.now() + 180
  return after.flatMap((unit, j) => {
    const old = before[matches[j]], element = elements[unit.index]
    if (!element || (old?.key === unit.key && !moved[j])) return []
    const spans: [number, number][] = []
    let offset = 0
    const diff = old && Date.now() < deadline ? diffArrays(old.tokens, unit.tokens, { timeout: Math.max(1, deadline - Date.now()), maxEditLength: 4000 }) : undefined
    if (diff) for (const part of diff) {
      if (part.removed) continue
      const length = part.value.reduce((n, token) => n + token.split('\0')[0].length, 0)
      if (part.added) spans.push([offset, offset + length])
      offset += length
    }
    else if (unit.text) spans.push([0, unit.text.length])
    const full = spans.length === 1 && spans[0][0] === 0 && spans[0][1] >= unit.text.replace(/\n$/, '').length
    return [{ element, spans, text: unit.text, whole: element.matches(atomic) && element.tagName !== 'PRE' || !spans.length, order: j, full }]
  })
}

// Map UTF-16 offsets back to the enhanced DOM without wrapping or replacing text.
// Code enhancement removes literal newlines, so insert their offsets between rows.
function ranges(change: Change): Range[] {
  const pieces: { node: Text; start: number }[] = []
  let text = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pieces.push({ node: node as Text, start: text.length }); text += node.textContent
    } else if (node instanceof Element) {
      if (node.matches(skipped)) return
      if (node.tagName === 'BR') { text += '\n'; return }
      if (node.matches('.yy-line') && node.previousElementSibling) text += '\n'
      node.childNodes.forEach(walk)
    }
  }
  walk(change.element)
  // Atomic diagrams/media and an incompatible text projection get a block marker.
  if (text.replace(/\n$/, '') !== change.text.replace(/\n$/, '')) return []
  return change.spans.flatMap(([start, end]) => {
    const a = pieces.find(p => p.start + p.node.length > start)
    const b = pieces.find(p => p.start < end && p.start + p.node.length >= end)
    if (!a || !b) return []
    const r = document.createRange()
    r.setStart(a.node, Math.max(0, start - a.start)); r.setEnd(b.node, end - b.start)
    return [r]
  })
}

// A patch spans its lane: the text column, or the cell/column/container holding the
// change. Media and code keep their own pixels and get a ring instead of a tint.
const lanes = 'td,th,.yy-column,.callout,.yy-highlight-block,.yy-fold-block'
const ringed = 'img,.yy-mermaid,.yy-drawing,[data-attachment],[data-image-board],[data-type="block-math"]'
const padX = 12, padY = 6
interface Box { left: number; top: number; right: number; bottom: number }
interface Block { changes: number[]; patch: number; target: Element; rect: DOMRect; lane: Element | null; ring: boolean; code: boolean; folded: boolean }

function clipOf(el: Element, self: boolean): Box {
  const box = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
  for (let p: Element | null = self ? el : el.parentElement; p && p !== document.body; p = p.parentElement) {
    const style = getComputedStyle(p), r = p.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { box.left = Math.max(box.left, r.left); box.right = Math.min(box.right, r.right) }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { box.top = Math.max(box.top, r.top); box.bottom = Math.min(box.bottom, r.bottom) }
  }
  return box
}

// Range rectangles repeat for nested inline elements; overlapping marks would darken.
function lineBoxes(rects: DOMRect[]): Box[] {
  const out: Box[] = []
  for (const r of rects.filter(r => r.width && r.height).sort((a, b) => a.left - b.left)) {
    const line = out.find(o => Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top) > Math.min(r.height, o.bottom - o.top) / 2 && r.left <= o.right + 2)
    if (line) Object.assign(line, { left: Math.min(line.left, r.left), right: Math.max(line.right, r.right), top: Math.min(line.top, r.top), bottom: Math.max(line.bottom, r.bottom) })
    else out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  }
  return out
}

export function showRecentChanges(options: { root: HTMLElement; elements: Element[]; html: string; beforeHTML: string; title: HTMLElement; beforeTitle: string; titleText: string }) {
  const changes = compare(collect(options.beforeHTML), collect(options.html), options.elements)
  if (options.beforeTitle !== options.titleText) changes.unshift({ element: options.title, spans: [[0, options.titleText.length]], text: options.titleText, whole: false, order: -2, full: true })
  // Adjacent changes in one lane are one patch for counting and navigation.
  const patchOf: number[] = []
  const patches: number[][] = []
  let previous: { target: Element; lane: Element | null; order: number } | undefined
  changes.forEach((change, i) => {
    const target = change.element.closest('.code-block') ?? change.element
    const lane = target.parentElement?.closest(lanes) ?? null
    const joined = previous && (previous.target === target || previous.order + 1 === change.order && previous.lane === lane)
    if (!joined) patches.push([])
    patches[patches.length - 1].push(i)
    patchOf[i] = patches.length - 1
    previous = { target, lane, order: change.order }
  })
  // Code blocks stay dark in both themes, so their marks blend separately.
  const layers = ['yy-recent-layer', 'yy-recent-layer is-code'].map(className => {
    const layer = Object.assign(document.createElement('div'), { className })
    layer.setAttribute('aria-hidden', 'true')
    document.body.append(layer)
    return layer
  })
  let frame = 0, destroyed = false, active = -1
  const paint = () => {
    frame = 0
    const fills = document.createDocumentFragment(), code = document.createDocumentFragment()
    const root = options.root.getBoundingClientRect()
    const add = (parent: Node, className: string, clip: Box, left: number, top: number, width: number, height: number) => {
      const el = Object.assign(document.createElement('i'), { className })
      Object.assign(el.style, { left: `${left - clip.left}px`, top: `${top - clip.top}px`, width: `${width}px`, height: `${height}px` })
      parent.appendChild(el)
      return el
    }
    const clipped = (parent: Node, clip: Box) => add(parent, 'yy-recent-clip', { left: 0, top: 0, right: 0, bottom: 0 }, clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top)

    const blocks: Block[] = []
    changes.forEach((change, i) => {
      if (!change.element.isConnected) return
      // Closed details can still report rectangles for descendants in WebKit and
      // Chromium. Mark the visible summary until navigation expands the content.
      let visible = change.element
      for (let p = visible.parentElement; p; p = p.parentElement) {
        if (p instanceof HTMLDetailsElement && !p.open) visible = p.querySelector(':scope > summary') ?? p
      }
      const folded = visible !== change.element
      const codeBlock = visible.closest('.code-block')
      const target = codeBlock ?? visible
      const previous = blocks.at(-1)
      if (previous?.target === target) { previous.changes.push(i); return }
      const rect = target.getBoundingClientRect()
      if (!rect.height) return
      const lane = target.parentElement?.closest(lanes)
      blocks.push({
        changes: [i], patch: patchOf[i], target, rect, folded, code: !!codeBlock,
        lane: lane && options.root.contains(lane) ? lane : null, ring: !!codeBlock || (!folded && change.element.matches(ringed)),
      })
    })

    const groups: Block[][] = []
    for (const block of blocks) {
      const group = groups.at(-1), last = group?.at(-1)
      if (group && last && last.patch === block.patch && last.lane === block.lane && block.rect.top >= last.rect.bottom - 1) group.push(block)
      else groups.push([block])
    }

    for (const group of groups) {
      const head = group[0], tail = group[group.length - 1], lane = head.lane
      let left: number, right: number, top = head.rect.top - padY, bottom = tail.rect.bottom + padY
      if (lane) {
        const s = getComputedStyle(lane), r = lane.getBoundingClientRect(), px = (v: string) => parseFloat(v) || 0
        const innerLeft = r.left + px(s.borderLeftWidth), innerRight = r.right - px(s.borderRightWidth)
        left = Math.max(innerLeft, innerLeft + px(s.paddingLeft) - padX)
        right = Math.min(innerRight, innerRight - px(s.paddingRight) + padX)
        top = Math.max(top, r.top + px(s.borderTopWidth)); bottom = Math.min(bottom, r.bottom - px(s.borderBottomWidth))
      } else {
        left = Math.min(root.left, ...group.map(b => b.rect.left)) - padX
        right = Math.max(root.right, ...group.map(b => b.rect.right)) + padX
      }
      top = Math.round(top); bottom = Math.round(bottom); left = Math.round(left); right = Math.round(right)
      const clip = clipOf(head.target, false)
      if (Math.min(clip.right, right) <= Math.max(clip.left, left) || Math.min(clip.bottom, bottom) <= Math.max(clip.top, top)) continue
      const box = clipped(fills, clip)
      if (head.patch === active) box.classList.add('is-current')
      // Fill the gaps between neighbouring blocks so a run of edits reads as one patch.
      group.forEach((block, k) => {
        const from = k ? Math.round((group[k - 1].rect.bottom + block.rect.top) / 2) : top
        const to = k < group.length - 1 ? Math.round((block.rect.bottom + group[k + 1].rect.top) / 2) : bottom
        const segment = add(box, 'yy-recent-fill' + (k ? '' : ' is-first') + (block === tail ? ' is-last' : ''), clip, left, from, right - left, to - from)
        if (block.ring) {
          const r = block.rect, w = (n: number) => `${Math.max(0, n)}px`
          segment.classList.add('is-ring')
          segment.style.borderWidth = [r.top - from, right - r.right, to - r.bottom, r.left - left].map(w).join(' ')
        }
      })
      add(box, 'yy-recent-stitch', clip, left + 3, top + 3, right - left - 6, bottom - top - 6)

      for (const block of group) {
        if (block.folded) continue
        for (const i of block.changes) {
          const change = changes[i]
          if (change.whole || change.full) continue
          const lines = lineBoxes(ranges(change).flatMap(r => [...r.getClientRects()]))
          if (!lines.length) continue
          const markClip = block.code ? clipOf(change.element, true) : clip
          const marks = block.code ? clipped(code, markClip) : box
          for (const l of lines) add(marks, 'yy-recent-mark', markClip, l.left - 1, l.top, l.right - l.left + 2, l.bottom - l.top)
        }
      }
    }
    layers[0].replaceChildren(fills)
    layers[1].replaceChildren(code)
  }
  const schedule = () => { if (!destroyed && !frame) frame = requestAnimationFrame(paint) }
  const resize = new ResizeObserver(schedule)
  resize.observe(options.root); resize.observe(document.documentElement)
  const mutation = new MutationObserver(schedule)
  mutation.observe(options.root, { subtree: true, attributes: true, childList: true, characterData: true })
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  schedule()
  return {
    count: patches.length,
    go(direction: number) {
      if (!patches.length) return 0
      active = active < 0 ? (direction > 0 ? 0 : patches.length - 1) : (active + direction + patches.length) % patches.length
      for (const i of patches[active]) {
        const el = changes[i].element
        reveal(el as HTMLElement)
        for (let p: Element | null = el; p; p = p.parentElement) {
          if (p.matches('.callout.is-collapsed,.code-block.is-collapsed')) p.classList.remove('is-collapsed')
        }
        el.querySelectorAll('.yy-line').forEach(line => line.dispatchEvent(new Event('yy-reveal-code', { bubbles: true })))
        const pre = el.matches('pre') ? el : el.querySelector('pre')
        if (pre?.classList.contains('is-folded')) (pre.closest('.code-block')?.nextElementSibling as HTMLElement | null)?.click()
      }
      // Centre the whole patch; a tall one starts below the top bar.
      const items = patches[active].map(i => changes[i].element)
      const first = items[0] as HTMLElement, height = items[items.length - 1].getBoundingClientRect().bottom - first.getBoundingClientRect().top
      first.style.scrollMarginTop = `${Math.max(88, (innerHeight - height) / 2)}px`
      first.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' })
      first.style.scrollMarginTop = ''
      schedule()
      return active + 1
    },
    destroy() {
      destroyed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect()
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); layers.forEach(l => l.remove())
    },
  }
}
