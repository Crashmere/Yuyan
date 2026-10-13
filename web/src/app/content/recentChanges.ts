import { reveal } from './folds'
import { collect, compare, skipped, type Change } from './recentDiff'
import { findGhosts, hideGhosts, keepPlace, showGhosts, type Ghost } from './recentGhosts'
import './recentChanges.css'

export interface Shown { edits: boolean; deletions: boolean }

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

// A stop is what one press of the navigation buttons shows: an edit patch with the deleted
// content beside it, or deleted content alone.
interface Stop { patch: number; ghosts: Ghost[]; elements: Element[] }
const documentOrder = (a: Element, b: Element) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1

// Nothing shows until set() chooses the kinds, which can depend on counts.
export function showRecentChanges(options: { root: HTMLElement; elements: Element[]; prepare?: (node: HTMLElement) => void; html: string; beforeHTML: string; title: HTMLElement; beforeTitle: string; titleText: string }) {
  const before = collect(options.beforeHTML), after = collect(options.html)
  const { changes, matches } = compare(before, after, options.elements)
  const titleChanged = options.beforeTitle !== options.titleText
  if (titleChanged) changes.unshift({ element: options.title, spans: [[0, options.titleText.length]], text: options.titleText, whole: false, order: -2, full: true })
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
  const changeAt = new Map(changes.map((change, i) => [change.order, i]))
  // Deleted content is extra: content it cannot place must not cost the edits.
  let ghosts: Ghost[] = []
  try {
    ghosts = findGhosts({
      before, after, matches, elements: options.elements, root: options.root, changeOf: order => changeAt.get(order) ?? -1,
      title: titleChanged ? { element: options.title, before: options.beforeTitle, after: options.titleText } : undefined,
    })
  } catch (e) { console.warn('recent changes', e) }
  // Deleted content counts with the patch made in its place, so a replacement is one change.
  const groupOf = (ghost: Ghost, k: number) => ghost.attach >= 0 ? patchOf[ghost.attach] : -1 - k
  let show: Shown = { edits: false, deletions: false }, stops: Stop[] = []
  const buildStops = () => {
    const list = new Map<number, Stop>()
    if (show.edits) patches.forEach((members, p) => list.set(p, { patch: p, ghosts: [], elements: members.map(i => changes[i].element) }))
    if (show.deletions) ghosts.forEach((ghost, k) => {
      const key = groupOf(ghost, k), stop = list.get(key) ?? list.set(key, { patch: -1, ghosts: [], elements: [] }).get(key)!
      stop.ghosts.push(ghost); stop.elements.push(...ghost.nodes)
    })
    stops = [...list.values()].filter(s => s.elements.length).map(s => (s.elements.sort(documentOrder), s)).sort((a, b) => documentOrder(a.elements[0], b.elements[0]))
  }
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
    if (!show.edits) { layers.forEach(l => l.replaceChildren()); return }
    // Copies of deleted content are real blocks: a patch stops at them instead of covering them.
    const cuts = show.deletions ? ghosts.flatMap(g => g.nodes).map(n => n.getBoundingClientRect()).filter(r => r.height) : []
    const across = (r: DOMRect, left: number, right: number) => r.left < right && r.right > left
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
      const cut = !!last && cuts.some(r => r.top >= last.rect.bottom - 1 && r.bottom <= block.rect.top + 1 && across(r, Math.min(last.rect.left, block.rect.left), Math.max(last.rect.right, block.rect.right)))
      if (group && last && !cut && last.patch === block.patch && last.lane === block.lane && block.rect.top >= last.rect.bottom - 1) group.push(block)
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
      for (const r of cuts) {
        if (!across(r, left, right)) continue
        if (r.bottom <= head.rect.top + 1 && r.bottom > top) top = r.bottom + 2
        if (r.top >= tail.rect.bottom - 1 && r.top < bottom) bottom = r.top - 2
      }
      top = Math.round(top); bottom = Math.round(bottom); left = Math.round(left); right = Math.round(right)
      const clip = clipOf(head.target, false)
      if (Math.min(clip.right, right) <= Math.max(clip.left, left) || Math.min(clip.bottom, bottom) <= Math.max(clip.top, top)) continue
      const box = clipped(fills, clip)
      if (head.patch === stops[active]?.patch) box.classList.add('is-current')
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
  const set = (next: Shown) => {
    if (next.deletions !== show.deletions) keepPlace(options.root, () => next.deletions ? showGhosts(ghosts, options.root, options.prepare) : hideGhosts(ghosts))
    show = { ...next }
    active = -1
    buildStops()
    schedule()
    return stops.length
  }
  return {
    counts: { edits: patches.length, deletions: new Set(ghosts.map(groupOf)).size },
    // Shows or hides each kind without comparing again; returns the number of stops.
    set,
    go(direction: number) {
      if (!stops.length) return 0
      active = active < 0 ? (direction > 0 ? 0 : stops.length - 1) : (active + direction + stops.length) % stops.length
      const stop = stops[active]
      for (const el of stop.elements) {
        reveal(el)
        for (let p: Element | null = el; p; p = p.parentElement) {
          if (p.matches('.callout.is-collapsed,.code-block.is-collapsed')) p.classList.remove('is-collapsed')
        }
        if (el.classList.contains('yy-recent-ghost')) continue
        el.querySelectorAll('.yy-line').forEach(line => line.dispatchEvent(new Event('yy-reveal-code', { bubbles: true })))
        const pre = el.matches('pre') ? el : el.querySelector('pre')
        if (pre?.classList.contains('is-folded')) (pre.closest('.code-block')?.nextElementSibling as HTMLElement | null)?.click()
      }
      for (const ghost of ghosts) for (const node of ghost.nodes) node.classList.toggle('is-current', stop.ghosts.includes(ghost))
      // Centre the whole stop; a tall one starts below the top bar.
      const first = stop.elements[0] as HTMLElement, height = stop.elements[stop.elements.length - 1].getBoundingClientRect().bottom - first.getBoundingClientRect().top
      first.style.scrollMarginTop = `${Math.max(88, (innerHeight - height) / 2)}px`
      first.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' })
      first.style.scrollMarginTop = ''
      schedule()
      return active + 1
    },
    destroy() {
      destroyed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect()
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); layers.forEach(l => l.remove())
      keepPlace(options.root, () => hideGhosts(ghosts))
    },
  }
}
