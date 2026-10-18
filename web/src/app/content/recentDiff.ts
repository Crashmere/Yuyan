import { diffArrays } from 'diff'

// Work against the original renderer output. Page controls, line numbers, search
// markers and diagram rendering must never become edits. Live elements are kept by
// DocContent before enhancement so no DOM paths depend on its generated wrappers.
export const units = '[data-calendar],p,h1,h2,h3,h4,h5,h6,pre,hr,img,.code-title,.callout-title,.yy-fold-title,[data-type="block-math"],.yy-drawing,[data-attachment],[data-image-board]'
export const atomic = '[data-calendar],pre,.yy-drawing,[data-attachment],[data-image-board],[data-type="block-math"]'
export const skipped = 'button,.code-lang,.yy-code-gutter,.yy-heading-tools,.yy-drawing-source,.yy-drawing-text'
export interface Unit { element: Element; index: number; key: string; kind: string; context: string; text: string; tokens: string[] }
// order is the unit position in the current document: consecutive changes form one patch.
// full means every character is new, so the patch alone marks it.
export interface Change { element: Element; spans: [number, number][]; text: string; whole: boolean; order: number; full: boolean }

function attributes(el: Element): string {
  return el.tagName + JSON.stringify([...el.attributes].filter(a => a.name !== 'id').map(a => [a.name, a.value]).sort())
}

export function collect(html: string): Unit[] {
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
// matches[j] is the earlier unit paired with current unit j, or -1 for new content.
export function compare(before: Unit[], after: Unit[], elements: Element[]): { changes: Change[]; matches: number[] } {
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
  const changes = after.flatMap((unit, j) => {
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
  return { changes, matches }
}

// Characters of `before` that are gone from `after`, as UTF-16 ranges of `before`.
// Formatting is ignored: restyled text still exists. Undefined when out of time.
export function removedText(before: string, after: string, timeout: number): [number, number][] | undefined {
  const parts = diffArrays([...before], [...after], { timeout: Math.max(1, timeout), maxEditLength: 4000 })
  if (!parts) return
  const spans: [number, number][] = []
  let offset = 0
  for (const part of parts) {
    if (part.added) continue
    const length = part.value.join('').length
    if (part.removed) spans.push([offset, offset + length])
    offset += length
  }
  return spans
}
