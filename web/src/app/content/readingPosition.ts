// The rendered top-level blocks have the same order as the editor's document nodes. Page-only
// controls are siblings too; they must not count as document blocks.
export interface ReadingPosition {
  block: number
  offset: number
}

export function captureReadingPosition(): ReadingPosition | undefined {
  const root = document.querySelector('.yy-doc-page .yy-content')
  if (!root || window.scrollY === 0) return
  const top = (document.querySelector('.yy-topbar')?.getBoundingClientRect().bottom ?? 0) + 16
  const blocks = [...root.children].filter((el) => !el.matches('.yy-code-fold, .yy-mermaid-error'))
  let position: ReadingPosition | undefined
  for (const [block, el] of blocks.entries()) {
    const rect = el.getBoundingClientRect()
    if (!rect.height) continue // Sections folded in the reader still count, but cannot be anchors.
    position = { block, offset: top - rect.top }
    if (rect.bottom > top) break
  }
  return position
}
