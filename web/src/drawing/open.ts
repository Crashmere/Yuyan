import { createApp } from 'vue'
import type { Editor, JSONContent } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { toast } from '../ui/toast'

let active = false
export async function openDrawing(editor: Editor, position?: number) {
  if (active || editor.isDestroyed) return
  active = true
  const original = position === undefined ? undefined : editor.state.doc.nodeAt(position)
  const originalDoc = editor.state.doc
  let pos = position, insertion = editor.state.selection.getBookmark()
  const map = ({ transaction }: { transaction: Transaction }) => {
    insertion = insertion.map(transaction.mapping)
    if (pos !== undefined) { const result = transaction.mapping.mapResult(pos, 1); pos = result.deleted ? undefined : result.pos }
  }
  const source = original?.attrs.src
  const scope = () => editor.extensionManager.extensions.find(e => e.name === 'drawing')?.options.draftScope?.() ?? location.pathname
  const draftKey = () => `${location.origin}:${scope()}:${pos ?? 'new'}:${source ?? ''}`
  editor.on('transaction', map)
  let cleanup = () => { active = false; editor.off('transaction', map) }
  try {
    const { default: DrawingDialog } = await import('./DrawingDialog.vue')
    if (editor.isDestroyed) { cleanup(); return }
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp(DrawingDialog, {
      src: source, draftKey,
      apply(node: JSONContent) {
        if (editor.isDestroyed) throw new Error('文档已关闭，画板草稿已保留')
        let tr = closeHistory(editor.state.tr)
        if (original) {
          if (pos === undefined || !editor.state.doc.nodeAt(pos)?.eq(original)) throw new Error('原画板已变化，请下载当前画板后重新打开')
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: original.attrs.width, blockAlign: original.attrs.blockAlign, caption: original.attrs.caption })
        } else {
          if (!editor.state.doc.eq(originalDoc)) throw new Error('正文已变化，请下载当前画板后重新插入')
          tr = tr.setSelection(insertion.resolve(editor.state.doc)).replaceSelectionWith(editor.schema.nodeFromJSON(node))
        }
        editor.view.dispatch(tr)
        editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
      },
      onClose() { app.unmount(); host.remove(); cleanup(); if (!editor.isDestroyed) editor.commands.focus(undefined, { scrollIntoView: false }) },
    })
    const previous = cleanup
    const onDestroy = () => { app.unmount(); host.remove(); cleanup() }
    cleanup = () => { previous(); editor.off('destroy', onDestroy) }
    editor.on('destroy', onDestroy)
    app.mount(host)
  } catch (e) { cleanup(); toast(e instanceof Error ? e.message : '画板加载失败', 'error') }
}
