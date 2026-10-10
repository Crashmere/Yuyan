import { computed, reactive, shallowRef } from 'vue'
import { api, ApiError, type Book, type BookGroup, type BookGroups, type Doc, type TreeNode } from '../shared/api'
import { forgetViewed } from './prefs'
import type { JSONContent } from '@tiptap/core'

// Shared client state: the knowledge base list, the trees seen so far, and what the current page
// is about (for the sidebar and the breadcrumb). Most writes refresh after saving; book grouping
// updates immediately so a dropped card stays at its destination while the request is in flight.

export const state = reactive({
  books: [] as Book[],
  booksLoaded: false,
  bookGroups: { revision: 0, groups: [] } as BookGroups,
  trees: {} as Record<number, TreeNode[] | undefined>,
  bookId: null as number | null,
  docId: null as number | null,
  loading: 0,
  navigating: false,
})
let confirmedBookGroups: BookGroups = state.bookGroups
let confirmedBooks: Book[] = state.books

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
  const [books, groups] = await Promise.all([api<Book[]>('books'), api<BookGroups>('book-groups')])
  state.books = books
  confirmedBooks = books
  confirmedBookGroups = groups
  state.bookGroups = groups
  state.booksLoaded = true
  return state.books
}

export const bookSections = computed(() => {
  const assigned = new Set(state.bookGroups.groups.flatMap((g) => g.bookIds))
  return [
    ...state.bookGroups.groups.map((g) => ({ id: g.id, name: g.name, books: state.books.filter((b) => g.bookIds.includes(b.id)) })),
    { id: '', name: '未分组', books: state.books.filter((b) => !assigned.has(b.id)) },
  ]
})

export async function saveBookGroups(groups: BookGroup[], books?: Book[]) {
  const previous = state.bookGroups
  if (books) state.books = books
  state.bookGroups = { revision: previous.revision, groups }
  const pending = state.bookGroups
  try {
    const saved = await api<BookGroups>('book-groups', { method: 'PUT', json: { groups, baseRevision: previous.revision, bookOrder: books?.map((b) => b.id) } })
    if (saved.revision > confirmedBookGroups.revision) {
      confirmedBookGroups = saved
      if (books) confirmedBooks = books
    }
    if (state.bookGroups === pending) state.bookGroups = saved
  } catch (e) {
    if (state.bookGroups === pending) {
      state.bookGroups = confirmedBookGroups
      if (books) state.books = confirmedBooks
    }
    // Roll back to confirmed data, including overlapping failed moves while offline.
    const refreshed = await loadBooks(true).then(() => true, () => false)
    if (e instanceof ApiError && e.status === 409) throw new Error(`分组已在别处修改，${refreshed ? '已刷新列表，请重试' : '请刷新列表后重试'}`)
    throw e
  }
}

export interface BookDropTarget { bookId: number; side: 'before' | 'after' }

export async function moveBookToGroup(bookId: number, groupId: string, target?: BookDropTarget) {
  const section = bookSections.value.find((g) => g.id === groupId)
  const moved = state.books.find((b) => b.id === bookId)
  if (!section || !moved || (target && !section.books.some((b) => b.id === target.bookId))) throw new Error('知识库列表已变化，请刷新后重试')
  if (target?.bookId === bookId) return
  const books = state.books.filter((b) => b.id !== bookId)
  const anchor = target?.bookId ?? section.books.filter((b) => b.id !== bookId).at(-1)?.id
  // An empty destination has no relative position to set; otherwise use the indicated side or end.
  const index = anchor === undefined ? state.books.indexOf(moved) : books.findIndex((b) => b.id === anchor) + (target?.side === 'before' ? 0 : 1)
  books.splice(index, 0, moved)
  const sameGroup = section.books.some((b) => b.id === bookId)
  if (sameGroup && books.every((b, i) => b.id === state.books[i]?.id)) return
  const groups = state.bookGroups.groups.map((g) => ({ ...g, bookIds: [...g.bookIds.filter((id) => id !== bookId), ...(g.id === groupId ? [bookId] : [])] }))
  await saveBookGroups(groups, books.map((b, i) => ({ ...b, position: i + 1 })))
}

const staleTrees = new Set<number>()

export function invalidateTree(bookId: number) {
  staleTrees.add(bookId)
}

export async function loadTree(bookId: number, force = false): Promise<TreeNode[]> {
  const cached = state.trees[bookId]
  if (cached && !force && !staleTrees.has(bookId)) return cached
  const tree = await api<TreeNode[]>(`books/${bookId}/tree`)
  state.trees[bookId] = tree
  staleTrees.delete(bookId)
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

export async function createDoc(bookId: number, parentId: number | null, kind: 'doc' | 'group' = 'doc', title?: string, content?: JSONContent): Promise<Doc> {
  const doc = await api<Doc>('docs', { method: 'POST', json: { bookId, parentId, kind, title: title ?? (kind === 'doc' ? '无标题文档' : '新分组'), content } })
  await refresh(bookId)
  return doc
}

// The open editor registers here, so a rename from elsewhere goes through its title field instead
// of changing the revision under its autosave.
export const editing = shallowRef<{ docId: number; setTitle: (title: string) => void; flush: () => Promise<boolean> } | null>(null)

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
  const ids = found ? collectIds(found.node) : [id]
  await api(`docs/${id}`, { method: 'DELETE' })
  forgetViewed(ids)
  const removed = locate(bookId, id)
  if (removed) removed.siblings.splice(removed.siblings.indexOf(removed.node), 1)
  invalidateTree(bookId)
  // A failed list refresh must not strand the user on a successfully deleted document.
  try { await refresh(bookId); return true }
  catch { return false }
}

function collectIds(n: TreeNode): number[] {
  return [n.id, ...(n.children ?? []).flatMap(collectIds)]
}

export async function batchDocs(bookId: number, ids: number[], action: 'copy' | 'move' | 'trash', target?: { bookId: number; parentId: number | null }) {
  let result: { ids: number[] }
  try {
    result = await api('docs/batch', { method: 'POST', json: { bookId, ids, action, targetBookId: target?.bookId, parentId: target?.parentId } })
  } catch (e) {
    await refresh(bookId, ...(target ? [target.bookId] : [])).catch(() => {})
    if (e instanceof ApiError && e.status === 409) throw new Error('目录已变化，请重新选择后重试')
    throw e
  }
  if (action === 'trash') forgetViewed(ids)
  try { await refresh(bookId, ...(target ? [target.bookId] : [])); return { ...result, refreshed: true } }
  catch { return { ...result, refreshed: false } }
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
