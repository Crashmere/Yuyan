import { base, type TreeNode } from '../../shared/api'
import { copyText } from '../../shared/clipboard'
import { confirm } from '../../ui/dialog'
import { toast } from '../../ui/toast'
import { moveRequest, runExport } from '../actions'
import { router } from '../router'
import * as store from '../store'

export type BatchAction = 'copy' | 'move' | 'export' | 'links' | 'trash'

export async function runBatch(action: BatchAction, bookId: number, nodes: TreeNode[], roots: TreeNode[]): Promise<boolean> {
  if (!nodes.length) return false
  const ids = nodes.map((n) => n.id)
  let target: { bookId: number; parentId: number | null } | null = null
  if (action === 'move' || action === 'copy') {
    target = await new Promise((resolve) => { moveRequest.value = { bookId, node: roots[0], nodes: roots, count: nodes.length, action, resolve } })
    if (!target) return false
  }
  if (action === 'trash' && !await confirm({ title: `将所选 ${nodes.length} 项移到回收站？`,
    message: '所选父项的子文档也包含在此数量内。删除后可以在回收站恢复。', confirmText: '移到回收站', danger: true })) return false

  const current = store.state.docId
  const currentInside = current != null && ids.includes(current)
  const parent = store.locate(bookId, current)?.path.findLast(node => !ids.includes(node.id))
  const destination = action === 'trash' && parent ? `/docs/${parent.id}` : `/books/${target?.bookId ?? bookId}`

  // Flush the open document before exporting/copying it. Structural operations leave
  // its editor first, so autosave cannot keep writing to a moved or deleted document.
  const editor = store.editing.value
  if (editor && ids.includes(editor.docId) && action !== 'links') {
    if (!await editor.flush()) throw new Error('当前文档尚未保存，请处理保存问题后重试')
    if (action === 'move' || action === 'trash') {
      const failure = action === 'trash' ? await router.replace(`/docs/${editor.docId}`) : await router.push(`/docs/${editor.docId}`)
      if (failure) return false
    }
  }
  if (action === 'links') {
    const links = nodes.filter((n) => n.kind === 'doc').map((n) => new URL(`${base}docs/${n.id}`, location.origin).href)
    if (!links.length) return false
    if (!await copyText(links.join('\n'))) throw new Error('未能写入剪贴板，请重试')
    toast(`已复制 ${links.length} 个文档链接`, 'success')
    return false
  }
  if (action === 'export') {
    await runExport(store.bookOf(bookId)?.name ?? '', roots, `${store.bookOf(bookId)?.name ?? '文档'}-所选文档`)
    return false
  }
  const route = router.currentRoute.value
  const result = await store.batchDocs(bookId, ids, action, target ?? undefined)
  toast(`${action === 'trash' ? '已移到回收站' : action === 'copy' ? '已复制' : '已移动'} ${nodes.length} 项${result.refreshed ? '' : '，请刷新页面以更新目录'}`, 'success')
  if (currentInside && router.currentRoute.value === route && action !== 'copy' && route.path !== destination) await router.replace(destination)
  return true
}
