import { reactive, watch } from 'vue'

// Display preferences live in this browser only; none of them is written into documents.

export type Theme = 'system' | 'light' | 'dark'

interface Prefs {
  theme: Theme
  sidebarWidth: number
  sidebarCollapsed: boolean
  // Whether the outlines beside the editor and beside a document being read are pinned (their eye
  // buttons); unpinned, they show as lines that open on hover.
  editorOutline: boolean
  readingOutline: boolean
  // Editing without the sidebar.
  focusMode: boolean
}

const prefsKey = 'yuyan:prefs'
// The page shell reads this key before the app loads, so the page never flashes the wrong theme.
const themeKey = 'yuyan:theme'

function load(): Partial<Prefs> {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey) ?? '{}') as Partial<Prefs> & { pageWidth?: unknown; codeLineNumbers?: unknown; codeWrap?: unknown }
    delete saved.pageWidth // All pages now use the former wide layout.
    delete saved.codeLineNumbers
    delete saved.codeWrap
    const theme = localStorage.getItem(themeKey)
    if (theme === 'light' || theme === 'dark') saved.theme = theme
    return saved
  } catch {
    return {}
  }
}

export const prefs = reactive<Prefs>({
  theme: 'system',
  sidebarWidth: 264,
  sidebarCollapsed: false,
  editorOutline: true,
  readingOutline: true,
  focusMode: false,
  ...load(),
})

// applyPrefs mirrors the display settings onto <html>, where the stylesheets pick them up.
export function applyPrefs() {
  const root = document.documentElement
  if (prefs.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = prefs.theme
  delete root.dataset.width
  root.classList.remove('yy-code-numbers', 'yy-code-wrap')
}

export function isDark(): boolean {
  return prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
}

watch(
  prefs,
  () => {
    applyPrefs()
    try {
      localStorage.setItem(prefsKey, JSON.stringify(prefs))
      if (prefs.theme === 'system') localStorage.removeItem(themeKey)
      else localStorage.setItem(themeKey, prefs.theme)
    } catch {
      // storage unavailable: preferences last for this page only
    }
  },
  { deep: true },
)

// Which tree nodes are expanded, per knowledge base.
export function loadExpanded(bookId: number): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`yuyan:tree:${bookId}`) ?? '[]') as number[])
  } catch {
    return new Set()
  }
}

export function saveExpanded(bookId: number, ids: Set<number>) {
  try {
    localStorage.setItem(`yuyan:tree:${bookId}`, JSON.stringify([...ids]))
  } catch {
    // ignore
  }
}

export interface Viewed {
  id: number
  title: string
  bookId: number
  bookName: string
  at: string
}

const viewedKey = 'yuyan:viewed'

export function recentlyViewed(): Viewed[] {
  try {
    return JSON.parse(localStorage.getItem(viewedKey) ?? '[]') as Viewed[]
  } catch {
    return []
  }
}

export function recordView(v: Omit<Viewed, 'at'>) {
  const list = [{ ...v, at: new Date().toISOString() }, ...recentlyViewed().filter((x) => x.id !== v.id)].slice(0, 30)
  try {
    localStorage.setItem(viewedKey, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export function forgetViewed(ids: number[]) {
  try {
    localStorage.setItem(viewedKey, JSON.stringify(recentlyViewed().filter((x) => !ids.includes(x.id))))
  } catch {
    // ignore
  }
}
