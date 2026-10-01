import type { Editor } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { chooseTemplate, saveTemplate, type ContentTemplate } from '../shared/templates'
import { imageSizes } from './images'
import { toast } from '../ui/toast'
import { api } from '../shared/api'

// Close open slice edges by filling required empty siblings. Never flatten rich structure.
// This handles partial lists, fold titles/bodies, cell rectangles and disjoint image picks.
export function selectedTemplate(e: Editor) {
  if (e.state.selection.empty) throw new Error('请先选中要保存的内容')
  function close(node: PMNode): PMNode {
    if (node.isLeaf) return node
    const children: PMNode[] = []; node.forEach(child => children.push(close(child)))
    const attrs = node.type.name === 'columns' && node.attrs.widths?.length !== Math.max(2, node.childCount) ? { ...node.attrs, widths: null } : node.attrs
    const value = node.type.createAndFill(attrs, Fragment.from(children), node.marks)
    if (!value) throw new Error('这部分内容需要连同外层块一起选择')
    return value
  }
  const blocks: PMNode[] = [], inline: PMNode[] = []
  function flush() { if (inline.length) { blocks.push(e.schema.nodes.paragraph.create(null, [...inline])); inline.length = 0 } }
  e.state.selection.content().content.forEach(node => {
    const value = close(node)
    if (value.isInline) inline.push(value)
    else { flush(); blocks.push(value) }
  })
  flush()
  if (blocks.length && blocks.every(node => node.type.name === 'tableRow')) {
    const rows = [...blocks]; blocks.splice(0, blocks.length, e.schema.nodes.table.create(null, rows))
  }
  const content = e.schema.topNodeType.createAndFill(null, blocks)
  if (!content) throw new Error('这部分内容需要连同外层块一起选择')
  content.check()
  return content.toJSON()
}

export async function saveEditorTemplate(e: Editor, kind: 'document' | 'snippet', title = '') {
  try { await saveTemplate(kind === 'document' ? e.getJSON() : selectedTemplate(e), kind, title) }
  catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
}

export function insertTemplate(e: Editor, item: ContentTemplate) {
  const content = e.schema.nodeFromJSON(item.content); content.check()
  Object.assign(imageSizes(e), item.images)
  // A closed slice keeps whole tables/columns/code blocks and makes the insert one undo step.
  const tr = closeHistory(e.state.tr).replaceSelection(new Slice(content.content, 0, 0)).scrollIntoView()
  if (!tr.docChanged) throw new Error('当前位置无法插入，请在正文段落中重试')
  e.view.dispatch(tr); e.view.dispatch(closeHistory(e.state.tr)); e.commands.focus()
}

export async function openTemplates(e: Editor) {
  const before = e.state.doc, bookmark = e.state.selection.getBookmark()
  const item = await chooseTemplate('insert')
  if (e.isDestroyed) return
  if (!item) { e.commands.focus(); return }
  if (!e.state.doc.eq(before)) { toast('文档内容已变化，请重新选择插入位置', 'error'); return }
  try { e.view.dispatch(e.state.tr.setSelection(bookmark.resolve(e.state.doc))); insertTemplate(e, item) }
  catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
}

export async function insertSavedTemplate(e: Editor, id: string) {
  const before = e.state.doc, bookmark = e.state.selection.getBookmark()
  try {
    const item = await api<ContentTemplate>(`templates/${id}`)
    if (e.isDestroyed) return
    if (!e.state.doc.eq(before)) throw new Error('文档内容已变化，请重新选择插入位置')
    e.view.dispatch(e.state.tr.setSelection(bookmark.resolve(e.state.doc)))
    insertTemplate(e, item)
  } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
}
