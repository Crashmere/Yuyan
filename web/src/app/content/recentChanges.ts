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
interface Change { element: Element; spans: [number, number][]; text: string; whole: boolean }

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
    return [{ element, spans, text: unit.text, whole: element.matches(atomic) && element.tagName !== 'PRE' || !spans.length }]
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

export function showRecentChanges(options: { root: HTMLElement; elements: Element[]; html: string; beforeHTML: string; title: HTMLElement; beforeTitle: string; titleText: string }) {
  const changes = compare(collect(options.beforeHTML), collect(options.html), options.elements)
  if (options.beforeTitle !== options.titleText) changes.unshift({ element: options.title, spans: [[0, options.titleText.length]], text: options.titleText, whole: false })
  const layer = Object.assign(document.createElement('div'), { className: 'yy-recent-layer' })
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)
  let frame = 0, destroyed = false, active = -1
  const paint = () => {
    frame = 0
    const fragment = document.createDocumentFragment()
    const article = options.root.closest('.yy-article')!.getBoundingClientRect()
    const add = (className: string, left: number, top: number, width: number, height: number) => {
      const el = Object.assign(document.createElement('i'), { className })
      Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
      fragment.append(el)
    }
    changes.forEach((change, i) => {
      if (!change.element.isConnected) return
      // Closed details can still report rectangles for descendants in WebKit and
      // Chromium. Mark the visible summary until navigation expands the content.
      let visible = change.element
      for (let p = visible.parentElement; p; p = p.parentElement) {
        if (p instanceof HTMLDetailsElement && !p.open) visible = p.querySelector(':scope > summary') ?? p
      }
      const rect = visible.getBoundingClientRect()
      if (!rect.height || rect.bottom < 0 || rect.top > innerHeight) return
      let left = Math.max(0, article.left), right = Math.min(innerWidth, article.right), top = 0, bottom = innerHeight
      for (let p = visible.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p), box = p.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
      }
      if (right <= left || bottom <= top) return
      const y = Math.max(top, rect.top), end = Math.min(bottom, rect.bottom)
      if (end <= y) return
      add('yy-recent-rail' + (i === active ? ' is-current' : ''), Math.max(3, article.left - 10), y, 3, Math.max(5, end - y))
      const rs = change.whole || visible !== change.element ? [] : ranges(change)
      if (!rs.length) {
        const x = Math.max(left, rect.left), edge = Math.min(right, rect.right)
        if (edge > x) add('yy-recent-frame', x, y, edge - x, end - y)
      }
      for (const range of rs) for (const r of range.getClientRects()) {
        const x = Math.max(left, r.left), edge = Math.min(right, r.right)
        if (r.width && r.height && edge > x && r.bottom >= top && r.bottom + 2 <= bottom) add('yy-recent-line', x, r.bottom + 1, edge - x, 3)
      }
    })
    layer.replaceChildren(fragment)
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
    count: changes.length,
    go(direction: number) {
      if (!changes.length) return 0
      active = active < 0 ? (direction > 0 ? 0 : changes.length - 1) : (active + direction + changes.length) % changes.length
      const change = changes[active], el = change.element as HTMLElement
      reveal(el)
      for (let p: Element | null = el; p; p = p.parentElement) {
        if (p.matches('.callout.is-collapsed,.code-block.is-collapsed')) p.classList.remove('is-collapsed')
      }
      el.querySelectorAll('.yy-line').forEach(line => line.dispatchEvent(new Event('yy-reveal-code', { bubbles: true })))
      const pre = el.matches('pre') ? el : el.querySelector('pre')
      if (pre?.classList.contains('is-folded')) (pre.closest('.code-block')?.nextElementSibling as HTMLElement | null)?.click()
      const target = ranges(change)[0]?.startContainer.parentElement ?? el
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      schedule()
      return active + 1
    },
    destroy() {
      destroyed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect()
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); layer.remove()
    },
  }
}
