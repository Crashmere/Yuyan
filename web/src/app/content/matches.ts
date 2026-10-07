import { reveal } from './folds'

// Highlights what was searched for in a document opened from search results, and brings the first
// match into view, opening folded sections, collapsed callouts and code blocks, and folded code on
// the way. The highlights use the CSS Custom Highlight API, which leaves the content untouched;
// without it the page only scrolls.

const name = 'yy-search'
// Matches do not run from one of these into the next, as the server's plain text breaks there too.
const blocks = '.yy-drawing-text, p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, figcaption, .callout-title, .yy-fold-title, .code-title, .yy-line, pre'
// Formulas and diagrams are redrawn from their source; buttons and language labels are not part of
// the text.
const skipped = '[data-type="inline-math"], [data-type="block-math"], code.language-mermaid, .yy-mermaid, button, .code-lang'
const limit = 500

export function findMatches(root: HTMLElement, query: string): Range[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  let text = ''
  const pieces: { node: Text; start: number }[] = []
  let block: Element | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(skipped) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const b = n.parentElement?.closest(blocks) ?? null
    if (b !== block) {
      text += '\n'
      block = b
    }
    pieces.push({ node: n as Text, start: text.length })
    text += (n as Text).data
  }
  // Lower-casing a few characters changes the length; match those texts as written.
  const lower = text.toLowerCase().length === text.length ? text.toLowerCase() : text
  const ranges: Range[] = []
  let k = 0
  for (let i = lower.indexOf(q); i >= 0 && ranges.length < limit; i = lower.indexOf(q, i + q.length)) {
    const end = i + q.length
    while (k + 1 < pieces.length && pieces[k + 1].start <= i) k++
    let m = k
    while (m + 1 < pieces.length && pieces[m + 1].start < end) m++
    const range = document.createRange()
    range.setStart(pieces[k].node, i - pieces[k].start)
    range.setEnd(pieces[m].node, end - pieces[m].start)
    ranges.push(range)
  }
  return ranges
}

// Returns how many matches there are.
export function showMatches(root: HTMLElement, query: string): number {
  const ranges = findMatches(root, query)
  if ('highlights' in CSS) CSS.highlights.set(name, new Highlight(...ranges))
  const at = ranges[0]?.startContainer.parentElement
  if (!at) return 0
  at.dispatchEvent(new Event('yy-reveal-code', { bubbles: true }))
  reveal(at)
  const collapsed = '.callout.is-collapsed, .code-block.is-collapsed'
  for (let c = at.closest(collapsed); c; c = c.parentElement?.closest(collapsed) ?? null) {
    c.classList.remove('is-collapsed')
  }
  const pre = at.closest<HTMLElement>('pre.is-folded')
  const line = at.closest('.yy-line')
  const shown = Number(pre?.style.getPropertyValue('--yy-fold-lines'))
  if (pre && line && [...line.parentElement!.children].indexOf(line) >= shown) {
    const fold = pre.closest('.code-block')?.nextElementSibling
    if (fold instanceof HTMLButtonElement && fold.classList.contains('yy-code-fold')) fold.click()
  }
  ;(at.closest('.yy-drawing') ?? at).scrollIntoView({ block: 'center' })
  at.closest('.yy-drawing')?.classList.add('yy-drawing-match')
  return ranges.length
}

export function clearMatches() {
  document.querySelectorAll('.yy-drawing-match').forEach(el => el.classList.remove('yy-drawing-match'))
  if ('highlights' in CSS) CSS.highlights.delete(name)
}
