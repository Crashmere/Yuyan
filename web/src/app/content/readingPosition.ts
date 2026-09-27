import { reveal } from './folds'

// The rendered top-level blocks have the same order as the editor's document nodes. Page-only
// controls are siblings too; they must not count as document blocks.
export interface ReadingPosition {
  block: number
  offset: number
}

const readingTop = () => (document.querySelector('.yy-topbar')?.getBoundingClientRect().bottom ?? 0) + 16
const readingBlocks = (root: Element) => [...root.children].filter((el) => !el.matches('.yy-code-fold, .yy-mermaid-error'))

export function captureBlockPosition(blocks: (Element | null)[], top: number): ReadingPosition | undefined {
  if (window.scrollY === 0) return
  let position: ReadingPosition | undefined
  for (const [block, el] of blocks.entries()) {
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (!rect.height) continue // Sections folded in the reader still count, but cannot be anchors.
    position = { block, offset: top - rect.top }
    if (rect.bottom > top) break
  }
  return position
}
export function captureReadingPosition(): ReadingPosition | undefined {
  const root = document.querySelector('.yy-doc-page .yy-content')
  return root ? captureBlockPosition(readingBlocks(root), readingTop()) : undefined
}

export function restoreReadingPosition(root: HTMLElement, position: ReadingPosition) {
  const blocks = readingBlocks(root)
  const block = blocks[Math.min(position.block, blocks.length - 1)]
  if (!block) return
  reveal(block)
  // Callouts are always expanded in the editor. Long untitled code also has no automatic fold
  // there, so open these within the target block before measuring its offset on the reading page.
  if (block.matches('.callout.is-collapsed')) block.classList.remove('is-collapsed')
  for (const callout of block.querySelectorAll('.callout.is-collapsed')) callout.classList.remove('is-collapsed')
  for (const pre of block.querySelectorAll('pre.is-folded')) {
    const button = pre.closest('.code-block')?.nextElementSibling
    if (button instanceof HTMLButtonElement && button.classList.contains('yy-code-fold')) button.click()
  }
  const rect = block.getBoundingClientRect()
  window.scrollBy({ top: rect.top + Math.min(position.offset, rect.height - 1) - readingTop(), behavior: 'instant' })
}
