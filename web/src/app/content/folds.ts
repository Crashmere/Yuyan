import { headingControl, headingSelector, readHeadingFolds, saveHeadingFolds, updateHeadingControl } from '../../shared/headingTools'

const levelOf = (el: Element) => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0)
// Copies shown by recent changes (recentGhosts.ts) and segments still being prepared inside their
// placeholders (segments.ts) are not part of the document. Others fold with the section they sit
// in; an earlier heading folds with the heading after it.
const headings = (root: HTMLElement) => [...root.querySelectorAll(headingSelector)].filter(h => !h.closest('.yy-recent-ghost, .yy-segment'))

// A placeholder for top-level blocks not loaded yet (segments.ts) stands for count blocks, with
// these headings among them; block is a heading's position within them. Folding, revealing and
// reading positions treat the placeholder as those blocks.
export interface VirtualHeading { block: number; level: number; id: string; foldable: boolean; folded?: boolean }
export const virtualBlocks = new WeakMap<Element, { count: number; headings: VirtualHeading[] }>()

// The level of the first block an element stands for, 0 if that is not a heading.
function firstLevel(el: Element) {
  const shape = virtualBlocks.get(el)
  if (!shape) return levelOf(el)
  const first = shape.headings[0]
  return first?.block === 0 ? first.level : 0
}

// Folds a placeholder's blocks as refreshFolds does real ones, hiding the placeholder when every
// block it stands for is hidden. Returns the level still folding the blocks after it.
function foldVirtual(el: Element, shape: { count: number; headings: VirtualHeading[] }, folded: number) {
  let shown = (shape.headings[0]?.block ?? shape.count) > 0 && !folded
  shape.headings.forEach((h, i) => {
    if (folded && h.level <= folded) folded = 0
    if (!folded) shown = true
    if (!folded && h.folded) folded = h.level
    if ((shape.headings[i + 1]?.block ?? shape.count) > h.block + 1 && !folded) shown = true
  })
  el.classList.toggle('yy-folded-away', !shown)
  return folded
}

export function refreshFolds(root: HTMLElement) {
  const parents = new Set(headings(root).map(h => h.parentElement!))
  parents.add(root)
  for (const parent of parents) {
    let folded = 0
    for (const el of parent.children) {
      const shape = virtualBlocks.get(el)
      if (shape) { folded = foldVirtual(el, shape, folded); continue }
      const level = levelOf(el.hasAttribute('data-fold-with-next') ? el.nextElementSibling ?? el : el)
      if (level && folded && level <= folded) folded = 0
      el.classList.toggle('yy-folded-away', folded > 0)
      if (level && !folded && el.classList.contains('is-folded')) folded = level
    }
  }
}

function save(root: HTMLElement) {
  const ids = headings(root).filter(h => h.classList.contains('is-folded')).map(h => h.id)
  for (const el of root.children) {
    for (const h of virtualBlocks.get(el)?.headings ?? []) if (h.folded) ids.push(h.id)
  }
  saveHeadingFolds(root.dataset.folds, ids.filter(Boolean))
}

function setFolded(heading: Element, folded: boolean) {
  heading.classList.toggle('is-folded', folded)
  const button = heading.querySelector<HTMLElement>(':scope > .yy-fold')
  if (button) updateHeadingControl(button, folded)
}

// The same level marker and folding arrow are used by the editor's decoration widgets. Safe to
// call again after more content arrives: headings already set up are left as they are.
export function setupFolds(root: HTMLElement, key?: string) {
  if (key) root.dataset.folds = key
  const saved = readHeadingFolds(key ?? root.dataset.folds)
  for (const el of root.children) {
    for (const h of virtualBlocks.get(el)?.headings ?? []) h.folded ??= h.foldable && saved.has(h.id)
  }
  for (const heading of headings(root)) {
    if (heading.querySelector(':scope > .yy-heading-tools')) continue
    const level = levelOf(heading), next = heading.nextElementSibling
    const foldable = !!next && (!firstLevel(next) || firstLevel(next) > level)
    const control = headingControl(level, foldable ? saved.has(heading.id) : undefined)
    if (foldable) control.addEventListener('click', () => {
      setFolded(heading, !heading.classList.contains('is-folded')); refreshFolds(root); save(root)
    })
    heading.prepend(control)
    if (foldable) setFolded(heading, saved.has(heading.id))
  }
  refreshFolds(root)
}

// Reveal nested scopes from inside out, including sections inside columns, callouts and cells.
// Headings that placeholders stand for unfold too, so the blocks they hid show once loaded.
export function reveal(el: Element) {
  const root = el.closest<HTMLElement>('.yy-content')
  if (!root) return
  let changed = false
  for (let block = el; block !== root && root.contains(block); block = block.parentElement!) {
    if (block.matches('details[data-fold-block]')) (block as HTMLDetailsElement).open = true
    if (!block.classList.contains('yy-folded-away')) continue
    let within = levelOf(block) || 7
    for (let prev = block.previousElementSibling; prev && within > 1; prev = prev.previousElementSibling) {
      const shape = virtualBlocks.get(prev)
      if (shape) {
        for (const h of [...shape.headings].reverse()) {
          if (h.level >= within) continue
          within = h.level
          if (h.folded) { h.folded = false; changed = true }
        }
        continue
      }
      const level = levelOf(prev)
      if (!level || level >= within) continue
      within = level
      if (prev.classList.contains('is-folded')) { setFolded(prev, false); changed = true }
    }
  }
  if (changed) { refreshFolds(root); save(root) }
}
