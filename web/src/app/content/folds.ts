import { headingControl, headingSelector, readHeadingFolds, saveHeadingFolds, updateHeadingControl } from '../../shared/headingTools'

const levelOf = (el: Element) => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0)

function apply(root: HTMLElement) {
  const parents = new Set([...root.querySelectorAll(headingSelector)].map(h => h.parentElement!))
  for (const parent of parents) {
    let folded = 0
    for (const el of parent.children) {
      const level = levelOf(el)
      if (level && folded && level <= folded) folded = 0
      el.classList.toggle('yy-folded-away', folded > 0)
      if (level && !folded && el.classList.contains('is-folded')) folded = level
    }
  }
}

function save(root: HTMLElement) {
  saveHeadingFolds(root.dataset.folds, [...root.querySelectorAll(headingSelector)].filter(h => h.classList.contains('is-folded')).map(h => h.id).filter(Boolean))
}

function setFolded(heading: Element, folded: boolean) {
  heading.classList.toggle('is-folded', folded)
  const button = heading.querySelector<HTMLElement>(':scope > .yy-fold')
  if (button) updateHeadingControl(button, folded)
}

// The same level marker and folding arrow are used by the editor's decoration widgets.
export function setupFolds(root: HTMLElement, key?: string) {
  if (key) root.dataset.folds = key
  const saved = readHeadingFolds(key)
  for (const heading of root.querySelectorAll(headingSelector)) {
    if (heading.querySelector(':scope > .yy-heading-tools')) continue
    const level = levelOf(heading), next = heading.nextElementSibling
    const foldable = !!next && (!levelOf(next) || levelOf(next) > level)
    const control = headingControl(level, foldable ? saved.has(heading.id) : undefined)
    if (foldable) control.addEventListener('click', () => {
      setFolded(heading, !heading.classList.contains('is-folded')); apply(root); save(root)
    })
    heading.prepend(control)
    if (foldable) setFolded(heading, saved.has(heading.id))
  }
  apply(root)
}

// Reveal nested scopes from inside out, including sections inside columns, callouts and cells.
export function reveal(el: Element) {
  const root = el.closest<HTMLElement>('.yy-content')
  if (!root) return
  let changed = false
  for (let block = el; block !== root && root.contains(block); block = block.parentElement!) {
    if (block.matches('details[data-fold-block]')) (block as HTMLDetailsElement).open = true
    if (!block.classList.contains('yy-folded-away')) continue
    let within = levelOf(block) || 7
    for (let prev = block.previousElementSibling; prev && within > 1; prev = prev.previousElementSibling) {
      const level = levelOf(prev)
      if (!level || level >= within) continue
      within = level
      if (prev.classList.contains('is-folded')) { setFolded(prev, false); changed = true }
    }
  }
  if (changed) { apply(root); save(root) }
}
