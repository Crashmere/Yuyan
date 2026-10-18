import { termPattern } from '../../shared/searchMatch'
import { scrollToElement } from '../../shared/scroll'
import { reveal } from './folds'

// Highlights the words searched for in a document opened from search results, and brings the first
// match into view, opening folded sections, collapsed callouts and code blocks, and folded code on
// the way. The highlights use the CSS Custom Highlight API, which leaves the content untouched;
// without it the page only scrolls.

const name = 'yy-search'
// Matches do not run from one of these into the next, as the server's plain text breaks there too.
const blocks = '.yy-drawing-text, p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, figcaption, .callout-title, .yy-fold-title, .code-title, .yy-line, pre'
// Formulas and diagrams are redrawn from their source; buttons and language labels are not part of
// the text, nor are copies of deleted content shown by recent changes.
const skipped = '.yy-calendar-panel, [data-type="inline-math"], [data-type="block-math"], code.language-mermaid, .yy-mermaid, button, .code-lang, .yy-recent-ghost, .yy-segment'
const limit = 500

export function findMatches(root: HTMLElement, query: string): Range[] {
  const pattern = termPattern(query)
  if (!pattern) return []
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
  const ranges: Range[] = []
  let k = 0
  for (let match = pattern.exec(text); match && ranges.length < limit; match = pattern.exec(text)) {
    const i = match.index
    const end = i + match[0].length
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
  scrollToElement(at.closest('.yy-drawing') ?? at, 'center')
  at.closest('.yy-drawing')?.classList.add('yy-drawing-match')
  return ranges.length
}

// Highlights matches in content that joined the page later, such as a segment of a long document.
export function addMatches(nodes: Element[], query: string) {
  const highlight = 'highlights' in CSS ? CSS.highlights.get(name) : undefined
  if (!highlight) return
  for (const node of nodes) {
    for (const range of findMatches(node as HTMLElement, query)) {
      if (highlight.size >= limit) return
      highlight.add(range)
    }
  }
}

export function clearMatches() {
  document.querySelectorAll('.yy-drawing-match').forEach(el => el.classList.remove('yy-drawing-match'))
  if ('highlights' in CSS) CSS.highlights.delete(name)
}
