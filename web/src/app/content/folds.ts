// Sections of a document fold away under their heading on reading pages, as in Obsidian and Yuque:
// the arrow before a heading hides everything up to the next heading of the same or a higher level.
// Folded headings are remembered per document in this browser, by heading id.

const levelOf = (el: Element) => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0)
const storageKey = (key: string) => `yuyan:folds:${key}`

// Hides the blocks of folded sections, including the headings nested in them.
function apply(root: HTMLElement) {
  let folded = 0
  for (const el of root.children) {
    const level = levelOf(el)
    if (level && folded && level <= folded) folded = 0
    el.classList.toggle('yy-folded-away', folded > 0)
    if (level && !folded && el.classList.contains('is-folded')) folded = level
  }
}

function save(root: HTMLElement) {
  const key = root.dataset.folds
  if (!key) return
  const ids = [...root.querySelectorAll(':scope > .is-folded')].map((h) => h.id).filter(Boolean)
  try {
    if (ids.length) localStorage.setItem(storageKey(key), JSON.stringify(ids))
    else localStorage.removeItem(storageKey(key))
  } catch {
    // storage unavailable: folds last for this page only
  }
}

function setFolded(heading: Element, folded: boolean) {
  heading.classList.toggle('is-folded', folded)
  const button = heading.querySelector(':scope > .yy-fold')
  button?.setAttribute('aria-expanded', String(!folded))
  button?.setAttribute('aria-label', folded ? '展开这一节' : '折叠这一节')
  button?.setAttribute('data-tip', folded ? '展开这一节' : '折叠这一节')
}

// Adds level markers and folding arrows to root headings, restoring the saved folds. key names
// the document; without it nothing is remembered.
export function setupFolds(root: HTMLElement, key?: string) {
  if (key) root.dataset.folds = key
  let saved: string[] = []
  try {
    saved = key ? (JSON.parse(localStorage.getItem(storageKey(key)) ?? '[]') as string[]) : []
  } catch {
    saved = []
  }
  const blocks = [...root.children]
  blocks.forEach((el, i) => {
    const level = levelOf(el)
    const next = blocks[i + 1]
    if (!level || el.querySelector(':scope > .yy-heading-tools')) return
    // Generated labels stay out of heading text, copied content and scroll-position matching.
    const marker = document.createElement('span')
    marker.className = 'yy-heading-level'
    marker.dataset.level = String(level)
    marker.setAttribute('aria-hidden', 'true')
    const foldable = next && (!levelOf(next) || levelOf(next) > level)
    if (!foldable) {
      const tools = document.createElement('span')
      tools.className = 'yy-heading-tools'
      tools.setAttribute('aria-hidden', 'true')
      tools.append(marker)
      el.prepend(tools)
      return
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'yy-heading-tools yy-fold'
    button.append(marker)
    button.addEventListener('click', () => {
      setFolded(el, !el.classList.contains('is-folded'))
      apply(root)
      save(root)
    })
    el.prepend(button)
    setFolded(el, saved.includes(el.id))
  })
  apply(root)
}

// Unfolds the sections hiding el, before scrolling to a heading or a search match inside them.
export function reveal(el: Element) {
  const root = el.closest<HTMLElement>('.yy-content')
  if (!root) return
  let block: Element = el
  while (block.parentElement && block.parentElement !== root) block = block.parentElement
  if (block.parentElement !== root || !block.classList.contains('yy-folded-away')) return
  let within = levelOf(block) || 7
  for (let prev = block.previousElementSibling; prev && within > 1; prev = prev.previousElementSibling) {
    const level = levelOf(prev)
    if (!level || level >= within) continue
    within = level
    if (prev.classList.contains('is-folded')) setFolded(prev, false)
  }
  apply(root)
  save(root)
}
