import { shallowRef } from 'vue'
import { ClipboardCopy, FilePlus, FolderInput, FolderPlus, History, PencilLine, SquarePen, Trash2 } from 'lucide-vue-next'
import { base, errorMessage, type Book, type TreeNode } from '../shared/api'
import { copyText } from '../shared/clipboard'
import { confirm, prompt } from '../ui/dialog'
import type { MenuEntry } from '../ui/menu'
import { toast } from '../ui/toast'
import { router } from './router'
import * as store from './store'

// User-facing operations shared by the tree, the document page and the knowledge base page.
// Each one asks for confirmation or input where needed and reports failures as toasts.

async function attempt(work: () => Promise<void>, failure: string) {
  try {
    await work()
  } catch (e) {
    toast(`${failure}：${errorMessage(e)}`, 'error')
  }
}

export function newDoc(bookId: number, parentId: number | null) {
  return attempt(async () => {
    const doc = await store.createDoc(bookId, parentId)
    await router.push(`/docs/${doc.id}/edit`)
  }, '新建文档失败')
}

export function newGroup(bookId: number, parentId: number | null) {
  return attempt(async () => {
    const title = await prompt({ title: '新建分组', placeholder: '分组名称', confirmText: '新建' })
    if (title) await store.createDoc(bookId, parentId, 'group', title)
  }, '新建分组失败')
}

export function renameDoc(bookId: number, node: { id: number; title: string; kind: string }) {
  return attempt(async () => {
    const title = await prompt({ title: node.kind === 'group' ? '重命名分组' : '重命名文档', value: node.title, confirmText: '保存' })
    if (title && title !== node.title) await store.renameDoc(bookId, node.id, title)
  }, '重命名失败')
}

export function deleteDoc(bookId: number, node: TreeNode) {
  return attempt(async () => {
    const children = node.children?.length ? '连同它下面的内容一起' : ''
    const ok = await confirm({
      title: `删除“${node.title}”？`,
      message: `${children}移到回收站，可以在回收站恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    const current = store.state.docId
    const inside = current != null && store.contains(node, current)
    await store.deleteDoc(bookId, node.id)
    toast('已移到回收站', 'success')
    if (inside) await router.replace(`/books/${bookId}`)
  }, '删除失败')
}

export function copyDocLink(id: number) {
  return attempt(async () => {
    const ok = await copyText(new URL(`${base}docs/${id}`, location.origin).href)
    toast(ok ? '链接已复制' : '复制失败，请手动复制地址栏中的链接', ok ? 'success' : 'error')
  }, '复制失败')
}

export interface MoveRequest {
  bookId: number
  node: TreeNode
  resolve: (target: { bookId: number; parentId: number | null } | null) => void
}

export const moveRequest = shallowRef<MoveRequest | null>(null)

export function moveDocTo(bookId: number, node: TreeNode) {
  return attempt(async () => {
    const target = await new Promise<{ bookId: number; parentId: number | null } | null>((resolve) => {
      moveRequest.value = { bookId, node, resolve }
    })
    if (!target) return
    await store.moveDoc(node.id, bookId, { ...target, index: Number.MAX_SAFE_INTEGER })
    toast('已移动', 'success')
  }, '移动失败')
}

export function nodeMenu(bookId: number, node: TreeNode, options: { rename?: () => void; history?: boolean } = {}): MenuEntry[] {
  return [
    { label: '新建子文档', icon: FilePlus, run: () => newDoc(bookId, node.id) },
    { label: '新建子分组', icon: FolderPlus, run: () => newGroup(bookId, node.id) },
    null,
    ...(node.kind === 'doc' ? [{ label: '编辑', icon: SquarePen, run: () => void router.push(`/docs/${node.id}/edit`) }] : []),
    { label: '重命名', icon: PencilLine, run: options.rename ?? (() => renameDoc(bookId, node)) },
    { label: '移动到…', icon: FolderInput, run: () => moveDocTo(bookId, node) },
    ...(node.kind === 'doc' ? [{ label: '复制链接', icon: ClipboardCopy, run: () => copyDocLink(node.id) }] : []),
    ...(options.history && node.kind === 'doc' ? [{ label: '历史版本', icon: History, run: () => void router.push(`/docs/${node.id}/history`) }] : []),
    null,
    { label: '删除', icon: Trash2, danger: true, run: () => deleteDoc(bookId, node) },
  ]
}

export function newBook() {
  return attempt(async () => {
    const name = await prompt({ title: '新建知识库', placeholder: '知识库名称', confirmText: '新建' })
    if (!name) return
    const book = await store.createBook(name)
    await router.push(`/books/${book.id}`)
  }, '新建知识库失败')
}

export function renameBook(book: Book) {
  return attempt(async () => {
    const name = await prompt({ title: '重命名知识库', value: book.name, confirmText: '保存' })
    if (name && name !== book.name) await store.updateBook(book.id, { name })
  }, '重命名失败')
}

export function editBookDescription(book: Book) {
  return attempt(async () => {
    const description = await prompt({ title: '知识库简介', value: book.description, placeholder: '一两句话介绍这个知识库', multiline: true, allowEmpty: true, confirmText: '保存' })
    if (description !== null && description !== book.description) await store.updateBook(book.id, { description })
  }, '保存简介失败')
}

export function deleteBook(book: Book) {
  return attempt(async () => {
    const ok = await confirm({ title: `删除知识库“${book.name}”？`, message: '整个知识库会移到回收站，可以在回收站恢复。', confirmText: '删除', danger: true })
    if (!ok) return
    await store.deleteBook(book.id)
    toast('已移到回收站', 'success')
    await router.replace('/')
  }, '删除失败')
}

export function bookMenu(book: Book): MenuEntry[] {
  return [
    { label: '新建文档', icon: FilePlus, run: () => newDoc(book.id, null) },
    { label: '新建分组', icon: FolderPlus, run: () => newGroup(book.id, null) },
    null,
    { label: '重命名', icon: PencilLine, run: () => renameBook(book) },
    { label: '编辑简介', icon: SquarePen, run: () => editBookDescription(book) },
    null,
    { label: '删除知识库', icon: Trash2, danger: true, run: () => deleteBook(book) },
  ]
}
