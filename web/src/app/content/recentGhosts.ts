import { diffArrays } from 'diff'
import { atomic, removedText, skipped, units, type Unit } from './recentDiff'
import { refreshFolds } from './folds'

// Deleted content is shown as copies of the earlier rendering, put back where it was.
// deleted: blocks that no longer exist. Otherwise the earlier version of an edited
// block, with the removed characters marked; code lists its lost lines instead.
// attach is the change it sits beside.
export interface Ghost {
  deleted: boolean
  kind: 'block' | 'item' | 'row' | 'cell' | 'title'
  items: Element[]
  text: string
  spans: [number, number][]
  lines?: CodeLine[]
  lost?: number[]
  anchor: Element
  after: boolean
  attach: number
  nodes: HTMLElement[]
}
// A line of the earlier code (0-based) that is gone, or edited in place with these characters removed.
interface CodeLine { line: number; spans?: [number, number][] }

// Code compares by line, as code is read: a line edited in place is paired with its new
// version and marks only what it lost; one that only gained characters is left out.
function lostLines(before: string, after: string, timeout: number): CodeLine[] | undefined {
  const parts = diffArrays(before.replace(/\n$/, '').split('\n'), after.replace(/\n$/, '').split('\n'), { timeout: Math.max(1, timeout), maxEditLength: 2000 })
  if (!parts) return
  const lines: CodeLine[] = []
  let line = 0
  parts.forEach((part, k) => {
    if (part.added) return
    if (part.removed) {
      const added = parts[k + 1]?.added ? parts[k + 1].value : []
      part.value.forEach((text, n) => {
        if (added[n] === undefined) { lines.push({ line: line + n }); return }
        const spans = removedText(text, added[n], timeout)
        if (spans?.length !== 0) lines.push({ line: line + n, spans })
      })
    }
    line += part.count
  })
  return lines
}

const titles = '.code-title,.callout-title,.yy-fold-title'
const media = 'img,[data-attachment],[data-type="block-math"],[data-type="inline-math"]'
const keyOf = (m: Element) => m.getAttribute('src') ?? m.getAttribute('data-src') ?? m.getAttribute('data-latex') ?? ''
const mediaOf = (el: Element) => [el, ...el.querySelectorAll(media)].filter(m => m.matches(media))
// Images, attachments and formulas of the earlier block that the new one no longer has, by position.
function lostMedia(before: Element, after: Element): number[] {
  const left = mediaOf(after).map(keyOf)
  return mediaOf(before).flatMap((m, n) => { const i = left.indexOf(keyOf(m)); if (i < 0) return [n]; left.splice(i, 1); return [] })
}

function lca(a: Node, b: Node): Node {
  const chain = new Set<Node>()
  for (let n: Node | null = a; n; n = n.parentNode) chain.add(n)
  for (let n: Node | null = b; n; n = n.parentNode) if (chain.has(n)) return n
  return a.getRootNode()
}
const depth = (n: Node) => { let d = 0; for (let p = n.parentNode; p; p = p.parentNode) d++; return d }
const childOf = (parent: Node, n: Node) => { while (n.parentNode !== parent) n = n.parentNode!; return n as Element }
const signature = (el: Element) => el.tagName.toLowerCase() + (el.classList[0] ? '.' + CSS.escape(el.classList[0]) : '')

// The live counterpart of oldItem, the ancestor of a surviving unit just below their
// common container. Enhancement wraps some blocks, so match tags rather than depth.
function mirror(live: Element, old: Element, oldItem: Element, container: Node, root: Element): Element | null {
  if (container.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    let n: Element | null = live
    while (n && n.parentElement !== root) n = n.parentElement
    return n
  }
  let n: Element | null = live
  for (let o = old; o !== oldItem; o = o.parentElement!) {
    n = n.parentElement?.closest(signature(o.parentElement!)) ?? null
    if (!n || !root.contains(n)) return null
  }
  return n.parentElement?.matches(signature(container as Element)) ? n : null
}

interface Input { before: Unit[]; after: Unit[]; matches: number[]; elements: Element[]; root: HTMLElement; changeOf: (order: number) => number; title?: { element: HTMLElement; before: string; after: string } }

export function findGhosts({ before, after, matches, elements, root, changeOf, title }: Input): Ghost[] {
  const removed: Ghost[] = [], earlier: Ghost[] = []
  const deadline = Date.now() + 150
  const afterOf = before.map(() => -1)
  matches.forEach((i, j) => { if (i >= 0) afterOf[i] = j })
  const live = (i: number) => elements[after[afterOf[i]].index]

  // Removed blocks go beside the surviving neighbour that shares the closest container.
  const next = before.map(() => -1)
  for (let i = before.length - 1, n = -1; i >= 0; i--) { next[i] = n; if (afterOf[i] >= 0) n = i }
  const used: Element[] = []
  let previous = -1
  before.forEach((unit, i) => {
    if (afterOf[i] >= 0) { previous = i; return }
    const u = unit.element
    const options = [previous, next[i]].map((k, n) => k < 0 || !live(k) ? undefined : { k, after: n === 0, container: lca(u, before[k].element) })
      .filter(o => !!o).sort((a, b) => depth(b.container) - depth(a.container))
    let item: Element, anchor: Element, place: boolean
    const best = options[0]
    if (!best) {
      if (!root.firstElementChild) return
      item = childOf(u.getRootNode(), u); anchor = root.firstElementChild; place = false
    } else {
      // Code blocks keep their own dark frame: their parts come back beside the whole block.
      const surviving = before[best.k].element, inCode = best.container instanceof Element && best.container.matches('.code-block')
      const liveItem = inCode ? null : mirror(live(best.k), surviving, childOf(best.container, surviving), best.container, root)
      item = liveItem ? childOf(best.container, u) : u
      anchor = liveItem ?? (live(best.k).matches(titles) ? live(best.k).closest('.code-block, .callout, details')! : live(best.k).closest('.code-block') ?? live(best.k))
      place = best.after
      if (liveItem && item.matches(titles)) { anchor = liveItem.parentElement?.closest('.code-block, .callout, details') ?? anchor; place = false }
    }
    if (used.some(x => x.contains(item))) return
    const kind = item.tagName === 'LI' ? 'item' : item.tagName === 'TR' ? 'row' : /^T[DH]$/.test(item.tagName) ? 'cell' : 'block'
    // A removed blank line only shows within other removed blocks.
    const last = removed.at(-1)
    const joins = !!last && kind === 'block' && last.kind === 'block' && last.anchor === anchor && last.after === place && last.items.at(-1)?.nextElementSibling === item
    if (!joins && !item.textContent?.trim() && !item.matches(`hr,img,${atomic}`) && !item.querySelector(`hr,img,${atomic}`)) return
    used.push(item)
    // Count it with the edit made in its place, or failing that the neighbour's own edit.
    const start = previous >= 0 ? afterOf[previous] : -1, end = next[i] >= 0 ? afterOf[next[i]] : after.length
    let attach = -1
    for (let n = start + 1; n < end && attach < 0; n++) attach = changeOf(n)
    if (attach < 0 && best) attach = changeOf(afterOf[best.k])
    if (joins) last!.items.push(item)
    else removed.push({ deleted: true, kind, items: [item], text: '', spans: [], anchor, after: place, attach, nodes: [] })
  })

  // Earlier versions of edited blocks that lost text, media, a formula or a diagram.
  after.forEach((unit, j) => {
    const i = matches[j], el = before[i]?.element, current = elements[unit.index]
    if (i < 0 || !current || before[i].key === unit.key) return
    const old = before[i], diagram = el.matches('pre') && !!el.querySelector('code.language-mermaid')
    // Out of time, code falls back to a copy of the whole earlier block.
    const lines = el.matches('pre') && !diagram ? lostLines(old.text, unit.text, deadline - Date.now()) : undefined
    const whole = el.matches(atomic) && !lines || !old.text.trim()
    const spans = whole || lines ? [] : removedText(old.text, unit.text, deadline - Date.now()) ?? [[0, old.text.length] as [number, number]]
    const lost = lines ? [] : lostMedia(el, unit.element)
    const shrank = lines ? lines.length > 0 : whole ? old.text !== unit.text && (removedText(old.text, unit.text, deadline - Date.now())?.length ?? 1) > 0 : spans.length > 0
    if (!shrank && !lost.length) return
    const li = el.parentElement?.closest('li'), item = !!li && li.querySelector(units) === el && !!current.closest('li')
    const anchor = el.matches(titles) ? current.closest('.code-block, .callout, details') ?? current : el.matches('pre') ? current.closest('.code-block') ?? current : item ? current.closest('li')! : current
    earlier.push({ deleted: false, kind: item ? 'item' : 'block', items: [el], text: old.text, spans, lines, lost: whole ? [] : lost, anchor, after: false, attach: changeOf(j), nodes: [] })
  })
  if (title) {
    const spans = removedText(title.before, title.after, deadline - Date.now()) ?? [[0, title.before.length]]
    const old = Object.assign(document.createElement('div'), { className: 'yy-doc-title', textContent: title.before })
    if (spans.length) earlier.unshift({ deleted: false, kind: 'title', items: [old], text: title.before, spans, anchor: title.element, after: false, attach: changeOf(-2), nodes: [] })
  }
  // Removed blocks first: before the same anchor they precede an edited block's old version.
  return [...removed, ...earlier]
}

function copy(el: Element): Element {
  const clone = document.importNode(el, true) as Element
  for (const e of [clone, ...clone.querySelectorAll('[id]')]) e.removeAttribute('id')
  for (const d of [clone, ...clone.querySelectorAll('details')]) if (d.matches('details')) d.setAttribute('open', '')
  return clone
}

function textNodes(el: Node): { node: Text; start: number }[] {
  const pieces: { node: Text; start: number }[] = []
  let length = 0
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { pieces.push({ node: node as Text, start: length }); length += (node as Text).length }
    else if (node instanceof Element && !node.matches(skipped)) { if (node.tagName === 'BR') length++; else node.childNodes.forEach(walk) }
  }
  walk(el)
  return pieces
}

// Wrap removed characters in <del>, from the end so earlier offsets stay valid. Text that
// had its own colour keeps it; plain text is darkened to stand out from the quieter copy.
// Removed spacing only counts in code.
function markRemoved(el: Node, spans: [number, number][], spacing = false) {
  for (const { node, start } of textNodes(el).reverse()) {
    const end = start + node.length
    const cuts = spans.filter(([a, b]) => a < end && b > start).map(([a, b]) => [Math.max(a, start) - start, Math.min(b, end) - start])
    const plain = !node.parentElement?.closest('[data-text-color], [data-highlight-color], mark, a, code, pre')
    for (const [a, b] of cuts.reverse()) {
      if (!spacing && !node.data.slice(a, b).trim()) continue
      const part = node.splitText(a)
      part.splitText(b - a)
      const del = document.createElement('del')
      if (plain) del.className = 'is-plain'
      part.replaceWith(del)
      del.append(part)
    }
  }
}

// The lost lines of edited code, highlighted and numbered as they were.
function codeCopy(pre: Element, text: string, lines: CodeLine[]): HTMLElement {
  const box = Object.assign(document.createElement('pre'), { className: `${pre.className} yy-recent-ghost-code` })
  const code = pre.querySelector('code') ?? pre, pieces = textNodes(code)
  const starts = [0]
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') starts.push(k + 1)
  let shown = -2
  for (const { line: n, spans } of lines) {
    if (shown >= 0 && n > shown + 1) box.append(Object.assign(document.createElement('span'), { className: 'yy-recent-ghost-line is-gap' }))
    shown = n
    const start = starts[n], end = n + 1 < starts.length ? starts[n + 1] - 1 : text.length
    const line = box.appendChild(Object.assign(document.createElement('span'), { className: 'yy-recent-ghost-line' }))
    line.dataset.line = String(n + 1)
    const content = line.appendChild(document.createElement('span'))
    const a = pieces.find(p => p.start + p.node.length >= start), b = pieces.find(p => p.start + p.node.length >= end)
    if (a && b && end > start) {
      const range = code.ownerDocument.createRange()
      range.setStart(a.node, Math.max(0, start - a.start)); range.setEnd(b.node, Math.max(0, end - b.start))
      content.append(document.importNode(range.cloneContents(), true))
      if (spans) markRemoved(content, spans, true)
    }
  }
  return box
}

const label = (text: string) => Object.assign(document.createElement('span'), { className: 'yy-recent-ghost-label', textContent: text })

function note<T extends HTMLElement>(el: T, ghost: Ghost): T {
  el.classList.add('yy-recent-ghost', ghost.deleted ? 'is-deleted' : 'is-before')
  el.setAttribute('role', 'note')
  el.setAttribute('aria-label', ghost.deleted ? '已删除的内容' : '修改前的内容')
  return el
}

// Numbered copies draw their earlier number themselves so the live numbering is untouched.
function marker(li: Element): string | undefined {
  const list = li.parentElement
  if (list?.tagName !== 'OL') return
  return `${Number(list.getAttribute('start') ?? 1) + [...list.children].indexOf(li)}.`
}

function build(ghost: Ghost): HTMLElement[] {
  const text = ghost.deleted ? '已删除' : '修改前'
  const mark = (el: Element) => {
    if (ghost.spans.length) markRemoved(el, ghost.spans)
    const all = mediaOf(el)
    for (const n of ghost.lost ?? []) all[n]?.classList.add('yy-recent-lost')
  }
  const content = (item: Element) => {
    if (ghost.lines) return codeCopy(item, ghost.text, ghost.lines)
    let clone = copy(item)
    if (item.matches(titles)) { const p = document.createElement('p'); p.append(...clone.childNodes); clone = p }
    if (!ghost.deleted) mark(clone)
    return clone
  }
  if (ghost.kind === 'item') return ghost.items.map(item => {
    const old = ghost.deleted ? item : item.parentElement!.closest('li')!
    const li = note(copy(old) as HTMLLIElement, ghost)
    if (!ghost.deleted) {
      // Keep only the edited paragraph (and a task checkbox); nested items are units of their own.
      const path: number[] = []
      for (let n: Element = item; n !== old; n = n.parentElement!) path.unshift([...n.parentElement!.children].indexOf(n))
      let target: Element = li
      for (const index of path) {
        const child = target.children[index]
        for (const sibling of [...target.children]) if (sibling !== child && sibling.tagName !== 'LABEL') sibling.remove()
        target = child
      }
      mark(target)
    }
    const number = marker(old)
    if (number) li.dataset.marker = number
    li.dataset.tip = ghost.deleted ? '已删除的列表项' : '修改前的列表项'
    return li
  })
  if (ghost.kind === 'row' || ghost.kind === 'cell') return ghost.items.map(item => {
    const el = note(copy(item) as HTMLElement, ghost)
    el.dataset.tip = ghost.kind === 'row' ? '已删除的行' : '已删除的单元格'
    return el
  })
  const box = note(document.createElement('div'), ghost)
  if (ghost.kind === 'title') box.classList.add('is-title')
  if (!ghost.deleted && /^H[1-6]$/.test(ghost.items[0].tagName)) box.dataset.foldWithNext = ''
  box.append(label(text), ...ghost.items.map(content))
  return [box]
}

// What the page adds after a block, a long code block's expand button or a diagram's error, stays with it.
const trailing = '.yy-code-fold, .yy-mermaid-error'
const end = (el: Element) => { while (el.nextElementSibling?.matches(trailing)) el = el.nextElementSibling; return el }

// prepare draws formulas, diagrams, tables and attachment cards in a copy, as on the page.
export function showGhosts(ghosts: Ghost[], root: HTMLElement, prepare?: (node: HTMLElement) => void) {
  const tails = new Map<Element, Element>()
  for (const ghost of ghosts) {
    try { ghost.nodes = build(ghost) } catch (e) { console.warn('recent changes', e); continue }
    if (!ghost.after) ghost.anchor.before(...ghost.nodes)
    else { (tails.get(ghost.anchor) ?? end(ghost.anchor)).after(...ghost.nodes); tails.set(ghost.anchor, ghost.nodes[ghost.nodes.length - 1]) }
  }
  refreshFolds(root)
  if (prepare) for (const node of ghosts.flatMap(g => g.nodes)) prepare(node)
}

export function hideGhosts(ghosts: Ghost[]) {
  for (const ghost of ghosts) { ghost.nodes.forEach(n => n.remove()); ghost.nodes = [] }
}

// Keep the line being read in place while copies appear or disappear above it. The browser's
// own scroll anchoring would pick another node and move the page a second time.
export function keepPlace(root: HTMLElement, change: () => void) {
  const line = (document.querySelector('.yy-topbar')?.getBoundingClientRect().bottom ?? 0) + 16
  let anchor: Element | undefined
  if (scrollY > 0) for (let el: Element | undefined = root; el?.children.length;) {
    const child: Element | undefined = [...el.children].find(c => !c.matches('.yy-recent-ghost, colgroup') && c.getClientRects().length > 0 && c.getBoundingClientRect().bottom > line)
    if (!child) break
    anchor = el = child
  }
  const top = anchor?.getBoundingClientRect().top
  const page = document.scrollingElement as HTMLElement | null
  if (page) page.style.overflowAnchor = 'none'
  change()
  if (anchor && top !== undefined && anchor.isConnected) {
    const moved = anchor.getBoundingClientRect().top - top
    if (Math.abs(moved) > 0.5) window.scrollBy({ top: moved, behavior: 'instant' })
  }
  requestAnimationFrame(() => requestAnimationFrame(() => page?.style.removeProperty('overflow-anchor')))
}
