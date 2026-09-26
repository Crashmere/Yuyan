import { api, ApiError, pageURL, type Doc } from '../shared/api'

interface Book {
  id: number
}

type Handler = (el: HTMLElement) => Promise<void>

const handlers: Record<string, Handler> = {
  'create-book': async () => {
    const name = window.prompt('知识库名称')?.trim()
    if (!name) return
    const b = await api<Book>('books', { method: 'POST', json: { name } })
    location.href = pageURL(`books/${b.id}`)
  },
  'rename-book': async (el) => {
    const name = window.prompt('新的知识库名称', el.dataset.name ?? '')?.trim()
    if (!name) return
    await api(`books/${el.dataset.book}`, { method: 'PATCH', json: { name } })
    location.reload()
  },
  'delete-book': async (el) => {
    if (!window.confirm('把整个知识库移到回收站？可以在回收站恢复。')) return
    await api(`books/${el.dataset.book}`, { method: 'DELETE' })
    location.href = pageURL('')
  },
  'create-doc': async (el) => {
    const d = await api<Doc>('docs', {
      method: 'POST',
      json: { bookId: Number(el.dataset.book), parentId: el.dataset.parent ? Number(el.dataset.parent) : null, kind: 'doc', title: '无标题文档' },
    })
    location.href = pageURL(`docs/${d.id}/edit`)
  },
  'create-group': async (el) => {
    const title = window.prompt('分组名称')?.trim()
    if (!title) return
    await api<Doc>('docs', { method: 'POST', json: { bookId: Number(el.dataset.book), parentId: null, kind: 'group', title } })
    location.reload()
  },
  'delete-doc': async (el) => {
    if (!window.confirm('把这篇文档（连同它的子文档）移到回收站？可以在回收站恢复。')) return
    await api(`docs/${el.dataset.doc}`, { method: 'DELETE' })
    location.href = pageURL(`books/${el.dataset.book}`)
  },
  'restore-version': async (el) => {
    if (!window.confirm('用这个版本替换当前内容？当前内容会先保存为一个历史版本。')) return
    await api(`versions/${el.dataset.version}/restore`, { method: 'POST', json: { baseRevision: Number(el.dataset.revision) } })
    location.href = pageURL(`docs/${el.dataset.doc}`)
  },
  'restore-book': async (el) => {
    await api(`books/${el.dataset.id}/restore`, { method: 'POST' })
    location.reload()
  },
  'restore-doc': async (el) => {
    await api(`docs/${el.dataset.id}/restore`, { method: 'POST' })
    location.reload()
  },
}

export function setupActions() {
  document.addEventListener('click', async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')
    const handler = el && handlers[el.dataset.action ?? '']
    if (!el || !handler) return
    e.preventDefault()
    el.setAttribute('disabled', '')
    try {
      await handler(el)
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409 ? '文档已在别处修改，请刷新后再试' : err instanceof Error ? err.message : String(err)
      window.alert(`操作失败：${msg}`)
    } finally {
      el.removeAttribute('disabled')
    }
  })
}
