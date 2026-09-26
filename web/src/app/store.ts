import { reactive, shallowRef } from 'vue'
import { api, type Book, type Doc, type TreeNode } from '../shared/api'
import { forgetViewed } from './prefs'

// Shared client state: the knowledge base list, the trees seen so far, and what the current page
// is about (for the sidebar and the breadcrumb). Writes go to the server first and then refresh
// what they changed, so the state never runs ahead of the database.

export const state = reactive({
  books: [] as Book[],
  booksLoaded: false,
  trees: {} as Record<number, TreeNode[] | undefined>,
  bookId: null as number | null,
  docId: null as number | null,
  loading: 0,
  navigating: false,
})

export async function loading<T>(work: Promise<T>): Promise<T> {
  state.loading++
  try {
    return await work
  } finally {
    state.loading--
  }
}

export function setPage(bookId: number | null, docId: number | null = null) {
  state.bookId = bookId
  state.docId = docId
}

export async function loadBooks(force = false): Promise<Book[]> {
  if (state.booksLoaded && !force) return state.books
  state.books = await api<Book[]>('books')
  state.booksLoaded = true
  return state.books
}

export async function loadTree(bookId: number, force = false): Promise<TreeNode[]> {
  const cached = state.trees[bookId]
  if (cached && !force) return cached
  const tree = await api<TreeNode[]>(`books/${bookId}/tree`)
  state.trees[bookId] = tree
  return tree
}

async function refresh(...bookIds: number[]) {
  await Promise.all([loadBooks(true), ...[...new Set(bookIds)].map((id) => loadTree(id, true))])
}

export function bookOf(id: number | null): Book | undefined {
  return state.books.find((b) => b.id === id)
}

export interface Located {
  node: TreeNode
  parent: TreeNode | null
  siblings: TreeNode[]
  // Ancestors from the top level down, not including the node.
  path: TreeNode[]
}

export function locate(bookId: number | null, id: number | null): Located | null {
  const roots = bookId == null ? undefined : state.trees[bookId]
  if (!roots || id == null) return null
  const walk = (nodes: TreeNode[], parent: TreeNode | null, path: TreeNode[]): Located | null => {
    for (const n of nodes) {
      if (n.id === id) return { node: n, parent, siblings: nodes, path }
      const found = walk(n.children ?? [], n, [...path, n])
      if (found) return found
    }
    return null
  }
  return walk(roots, null, [])
}

export function contains(node: TreeNode, id: number): boolean {
  return node.id === id || (node.children ?? []).some((c) => contains(c, id))
}

export function setNodeTitle(bookId: number, id: number, title: string) {
  const found = locate(bookId, id)
  if (found) found.node.title = title
}

export async function createDoc(bookId: number, parentId: number | null, kind: 'doc' | 'group' = 'doc', title?: string): Promise<Doc> {
  const doc = await api<Doc>('docs', { method: 'POST', json: { bookId, parentId, kind, title: title ?? (kind === 'doc' ? '无标题文档' : '新分组') } })
  await refresh(bookId)
  return doc
}

// The open editor registers here, so a rename from elsewhere goes through its title field instead
// of changing the revision under its autosave.
export const editing = shallowRef<{ docId: number; setTitle: (title: string) => void } | null>(null)

export async function renameDoc(bookId: number, id: number, title: string) {
  const t = title.trim()
  if (editing.value?.docId === id) editing.value.setTitle(t)
  else await api(`docs/${id}`, { method: 'PATCH', json: { title: t } })
  setNodeTitle(bookId, id, t)
}

export async function moveDoc(id: number, fromBookId: number, to: { bookId: number; parentId: number | null; index: number }) {
  try {
    await api(`docs/${id}/move`, { method: 'POST', json: to })
  } finally {
    await refresh(fromBookId, to.bookId)
  }
}

export async function deleteDoc(bookId: number, id: number) {
  const found = locate(bookId, id)
  await api(`docs/${id}`, { method: 'DELETE' })
  if (found) forgetViewed(collectIds(found.node))
  await refresh(bookId)
}

function collectIds(n: TreeNode): number[] {
  return [n.id, ...(n.children ?? []).flatMap(collectIds)]
}

export async function createBook(name: string): Promise<Book> {
  const book = await api<Book>('books', { method: 'POST', json: { name } })
  await loadBooks(true)
  return book
}

export async function updateBook(id: number, patch: { name?: string; description?: string }) {
  await api(`books/${id}`, { method: 'PATCH', json: patch })
  await loadBooks(true)
}

export async function deleteBook(id: number) {
  await api(`books/${id}`, { method: 'DELETE' })
  delete state.trees[id]
  await loadBooks(true)
}

export async function reorderBooks(ids: number[]) {
  try {
    await api('books/order', { method: 'PUT', json: { ids } })
  } finally {
    await loadBooks(true)
  }
}
