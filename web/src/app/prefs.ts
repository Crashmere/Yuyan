import { reactive, watch } from 'vue'
import { ListOrdered, MoveHorizontal, TextWrap } from 'lucide-vue-next'
import type { MenuEntry } from '../ui/menu'

// Display preferences live in this browser only; none of them is written into documents.

export type Theme = 'system' | 'light' | 'dark'

interface Prefs {
  theme: Theme
  sidebarWidth: number
  sidebarCollapsed: boolean
  // Content column: standard (800 px) or wide (1100 px), for reading and editing.
  pageWidth: 'standard' | 'wide'
  // The outline beside the editor.
  editorOutline: boolean
  // Editing without the sidebar.
  focusMode: boolean
  codeLineNumbers: boolean
  codeWrap: boolean
}

const prefsKey = 'yuyan:prefs'
// The page shell reads this key before the app loads, so the page never flashes the wrong theme.
const themeKey = 'yuyan:theme'

function load(): Partial<Prefs> {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey) ?? '{}') as Partial<Prefs>
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
  pageWidth: 'standard',
  editorOutline: true,
  focusMode: false,
  codeLineNumbers: false,
  codeWrap: false,
  ...load(),
})

// applyPrefs mirrors the display settings onto <html>, where the stylesheets pick them up.
export function applyPrefs() {
  const root = document.documentElement
  if (prefs.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = prefs.theme
  root.dataset.width = prefs.pageWidth
  root.classList.toggle('yy-code-numbers', prefs.codeLineNumbers)
  root.classList.toggle('yy-code-wrap', prefs.codeWrap)
}

// Menu entries for the page width and code display, offered in the appearance menu and the editor.
export function displayItems(): MenuEntry[] {
  return [
    { label: '标准宽度', icon: MoveHorizontal, checked: prefs.pageWidth === 'standard', run: () => void (prefs.pageWidth = 'standard') },
    { label: '宽屏', icon: MoveHorizontal, checked: prefs.pageWidth === 'wide', run: () => void (prefs.pageWidth = 'wide') },
    null,
    { label: '代码行号', icon: ListOrdered, checked: prefs.codeLineNumbers, run: () => void (prefs.codeLineNumbers = !prefs.codeLineNumbers) },
    { label: '代码自动换行', icon: TextWrap, checked: prefs.codeWrap, run: () => void (prefs.codeWrap = !prefs.codeWrap) },
  ]
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
