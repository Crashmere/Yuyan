import type { Component } from 'vue'
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import {
  Bold, Code, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, Highlighter, Image, Italic, Link, List, ListOrdered,
  ListTodo, MessageSquareText, Minus, Pilcrow, Quote, Radical, Sigma, SquareCode, Strikethrough, Table, Underline, Workflow,
} from 'lucide-vue-next'
import type { EditorUi } from './context'

// Commands shared by the toolbar, the selection toolbar, the slash menu and the block menu. Every
// command works on the existing document schema; nothing here adds a new node or attribute.

export interface TextStyle {
  id: string
  label: string
  icon: Component
  shortcut: string
  active: (e: Editor) => boolean
  apply: (e: Editor) => void
}

const headingIcons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6]

export const textStyles: TextStyle[] = [
  { id: 'p', label: '正文', icon: Pilcrow, shortcut: 'Mod-Alt-0', active: (e) => e.isActive('paragraph'), apply: (e) => e.chain().focus().setParagraph().run() },
  ...headingIcons.map((icon, i) => {
    const level = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6
    return {
      id: `h${level}`,
      label: `标题 ${level}`,
      icon,
      shortcut: `Mod-Alt-${level}`,
      active: (e: Editor) => e.isActive('heading', { level }),
      apply: (e: Editor) => e.chain().focus().setHeading({ level }).run(),
    }
  }),
]

export function currentStyle(e: Editor): TextStyle | undefined {
  return textStyles.find((s) => s.active(e))
}

export interface MarkButton {
  name: string
  label: string
  icon: Component
  shortcut: string
  toggle: (e: Editor) => void
}

export const markButtons: MarkButton[] = [
  { name: 'bold', label: '粗体', icon: Bold, shortcut: 'Mod-B', toggle: (e) => e.chain().focus().toggleBold().run() },
  { name: 'italic', label: '斜体', icon: Italic, shortcut: 'Mod-I', toggle: (e) => e.chain().focus().toggleItalic().run() },
  { name: 'strike', label: '删除线', icon: Strikethrough, shortcut: 'Mod-Shift-X', toggle: (e) => e.chain().focus().toggleStrike().run() },
  { name: 'underline', label: '下划线', icon: Underline, shortcut: 'Mod-U', toggle: (e) => e.chain().focus().toggleUnderline().run() },
  { name: 'code', label: '行内代码', icon: Code, shortcut: 'Mod-E', toggle: (e) => e.chain().focus().toggleCode().run() },
  { name: 'highlight', label: '高亮', icon: Highlighter, shortcut: 'Mod-Shift-H', toggle: (e) => e.chain().focus().toggleHighlight().run() },
]

export const listButtons: MarkButton[] = [
  { name: 'bulletList', label: '无序列表', icon: List, shortcut: 'Mod-Shift-8', toggle: (e) => e.chain().focus().toggleBulletList().run() },
  { name: 'orderedList', label: '有序列表', icon: ListOrdered, shortcut: 'Mod-Shift-7', toggle: (e) => e.chain().focus().toggleOrderedList().run() },
  { name: 'taskList', label: '任务列表', icon: ListTodo, shortcut: 'Mod-Shift-9', toggle: (e) => e.chain().focus().toggleTaskList().run() },
]

export function clearFormatting(e: Editor) {
  e.chain().focus().unsetAllMarks().run()
}

export function insertCallout(e: Editor, type = 'note') {
  e.chain()
    .focus()
    .insertContent({ type: 'callout', attrs: { type, fold: '' }, content: [{ type: 'calloutTitle' }, { type: 'calloutContent', content: [{ type: 'paragraph' }] }] })
    .run()
}

// Inserts an empty formula and opens the formula panel on it.
function insertMath(e: Editor, ui: EditorUi, kind: 'inlineMath' | 'blockMath') {
  const pos = e.state.selection.from
  if (kind === 'inlineMath') e.chain().focus().insertInlineMath({ latex: '' }).run()
  else e.chain().focus().insertBlockMath({ latex: '' }).run()
  // A block formula lands after the current paragraph; find the empty formula nearest the cursor.
  let target = -1
  e.state.doc.nodesBetween(Math.max(0, pos - 2), Math.min(e.state.doc.content.size, pos + 4), (node, at) => {
    if (target < 0 && node.type.name === kind && !node.attrs.latex) target = at
  })
  if (target >= 0) ui.openMath(target, true)
}

export interface InsertItem {
  id: string
  label: string
  description: string
  icon: Component
  group: '基础' | '列表' | '插入' | '提示块'
  markdown?: string
  keywords: string
  run: (e: Editor, ui: EditorUi, anchor?: DOMRect) => void
}

export const insertItems: InsertItem[] = [
  { id: 'p', label: '正文', description: '普通段落', icon: Pilcrow, group: '基础', keywords: 'zw text paragraph', run: (e) => e.chain().focus().setParagraph().run() },
  { id: 'h1', label: '标题 1', description: '大标题', icon: Heading1, group: '基础', markdown: '#', keywords: 'bt1 h1 heading', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: '标题 2', description: '中标题', icon: Heading2, group: '基础', markdown: '##', keywords: 'bt2 h2 heading', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: '标题 3', description: '小标题', icon: Heading3, group: '基础', markdown: '###', keywords: 'bt3 h3 heading', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'bullet', label: '无序列表', description: '圆点列表', icon: List, group: '列表', markdown: '-', keywords: 'wxlb bullet list ul', run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: '有序列表', description: '带编号的列表', icon: ListOrdered, group: '列表', markdown: '1.', keywords: 'yxlb ordered list ol', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'task', label: '任务列表', description: '可勾选的待办', icon: ListTodo, group: '列表', markdown: '[ ]', keywords: 'rwlb todo task', run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: '引用', description: '引用一段话', icon: Quote, group: '插入', markdown: '>', keywords: 'yy quote blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: '代码块', description: '带语法高亮的代码', icon: SquareCode, group: '插入', markdown: '```', keywords: 'dmk code', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  {
    id: 'titledCode', label: '带标题的代码块', description: '有标题栏，可以收起', icon: SquareCode, group: '插入', keywords: 'dbtddmk btdmk code title',
    run: (e) => e.chain().focus().toggleCodeBlock().updateAttributes('codeBlock', { title: '' }).run(),
  },
  {
    id: 'mermaid', label: 'Mermaid 图表', description: '用文字画流程图、时序图', icon: Workflow, group: '插入', markdown: '```mermaid', keywords: 'mermaid tb chart diagram lct',
    run: (e) => e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\n  A[开始] --> B[结束]' }] }).run(),
  },
  { id: 'table', label: '表格', description: '选择行数和列数', icon: Table, group: '插入', keywords: 'bg table', run: (e, ui, anchor) => ui.openTableGrid(anchor ?? coordsRect(e)) },
  { id: 'image', label: '图片', description: '上传图片，也可以直接粘贴或拖入', icon: Image, group: '插入', keywords: 'tp image picture', run: (_e, ui) => ui.pickImage() },
  { id: 'link', label: '链接', description: '网址或本站文档的链接', icon: Link, group: '插入', keywords: 'lj link url', run: (_e, ui) => ui.openLink() },
  { id: 'hr', label: '分割线', description: '分隔上下内容', icon: Minus, group: '插入', markdown: '---', keywords: 'fgx hr divider', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'blockMath', label: '公式块', description: '独占一行的 LaTeX 公式', icon: Sigma, group: '插入', markdown: '$$', keywords: 'gsk math formula latex', run: (e, ui) => insertMath(e, ui, 'blockMath') },
  { id: 'inlineMath', label: '行内公式', description: '嵌在文字中的公式', icon: Radical, group: '插入', markdown: '$…$', keywords: 'hngs inline math', run: (e, ui) => insertMath(e, ui, 'inlineMath') },
  { id: 'note', label: '提示', description: 'Callout：提示', icon: MessageSquareText, group: '提示块', markdown: '[!note]', keywords: 'ts callout note', run: (e) => insertCallout(e, 'note') },
  { id: 'tip', label: '技巧', description: 'Callout：技巧', icon: MessageSquareText, group: '提示块', markdown: '[!tip]', keywords: 'jq callout tip', run: (e) => insertCallout(e, 'tip') },
  { id: 'warning', label: '警告', description: 'Callout：警告', icon: MessageSquareText, group: '提示块', markdown: '[!warning]', keywords: 'jg callout warning', run: (e) => insertCallout(e, 'warning') },
]

export function coordsRect(e: Editor): DOMRect {
  const c = e.view.coordsAtPos(e.state.selection.from)
  return new DOMRect(c.left, c.top, 1, c.bottom - c.top)
}

// ---------------------------------------------------------------------------------------------
// Blocks under the drag handle. pos is the position before the block.

export interface BlockTarget {
  id: string
  label: string
  icon: Component
}

export const blockTargets: BlockTarget[] = [
  { id: 'p', label: '正文', icon: Pilcrow },
  { id: 'h1', label: '标题 1', icon: Heading1 },
  { id: 'h2', label: '标题 2', icon: Heading2 },
  { id: 'h3', label: '标题 3', icon: Heading3 },
  { id: 'bullet', label: '无序列表', icon: List },
  { id: 'ordered', label: '有序列表', icon: ListOrdered },
  { id: 'task', label: '任务列表', icon: ListTodo },
  { id: 'quote', label: '引用', icon: Quote },
  { id: 'code', label: '代码块', icon: SquareCode },
  { id: 'callout', label: 'Callout', icon: MessageSquareText },
]

function selectBlock(e: Editor, pos: number, node: PMNode) {
  const tr = e.state.tr
  const $from = tr.doc.resolve(pos + 1)
  const $to = tr.doc.resolve(pos + node.nodeSize - 1)
  e.view.dispatch(tr.setSelection(TextSelection.between($from, $to)))
}

export function turnInto(e: Editor, pos: number, target: string) {
  let node = e.state.doc.nodeAt(pos)
  if (!node) return
  // A callout is unwrapped first; converting to Callout keeps a callout as it is.
  if (node.type.name === 'callout') {
    if (target === 'callout') return
    const body = node.child(1).content
    e.view.dispatch(e.state.tr.replaceWith(pos, pos + node.nodeSize, body))
    node = e.state.doc.nodeAt(pos)
    if (!node) return
    if (body.childCount > 1) {
      const end = pos + body.size
      e.view.dispatch(e.state.tr.setSelection(TextSelection.between(e.state.doc.resolve(pos + 1), e.state.doc.resolve(end - 1))))
    } else selectBlock(e, pos, node)
  } else if (target === 'callout') {
    const s = e.state.schema.nodes
    const callout = s.callout.create({ type: 'note', fold: '' }, [s.calloutTitle.create(), s.calloutContent.create(null, node)])
    const tr = e.state.tr.replaceWith(pos, pos + node.nodeSize, callout)
    e.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2))))
    e.commands.focus()
    return
  } else {
    selectBlock(e, pos, node)
  }
  const chain = e.chain().focus().clearNodes()
  const done = {
    p: () => chain.run(),
    h1: () => chain.setHeading({ level: 1 }).run(),
    h2: () => chain.setHeading({ level: 2 }).run(),
    h3: () => chain.setHeading({ level: 3 }).run(),
    bullet: () => chain.toggleBulletList().run(),
    ordered: () => chain.toggleOrderedList().run(),
    task: () => chain.toggleTaskList().run(),
    quote: () => chain.toggleBlockquote().run(),
    code: () => chain.setCodeBlock().run(),
  }[target]
  done?.()
}

export function duplicateBlock(e: Editor, pos: number) {
  const node = e.state.doc.nodeAt(pos)
  if (!node) return
  const at = pos + node.nodeSize
  const tr = e.state.tr.insert(at, node)
  e.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView())
  e.commands.focus()
}

export function deleteBlock(e: Editor, pos: number) {
  const node = e.state.doc.nodeAt(pos)
  if (!node) return
  const tr = e.state.tr
  if (e.state.doc.childCount === 1) tr.replaceWith(pos, pos + node.nodeSize, e.state.schema.nodes.paragraph.create())
  else tr.delete(pos, pos + node.nodeSize)
  e.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)))).scrollIntoView())
  e.commands.focus()
}

export function moveBlock(e: Editor, pos: number, dir: -1 | 1) {
  const $pos = e.state.doc.resolve(pos)
  const index = $pos.index()
  const parent = $pos.parent
  const target = index + dir
  if (target < 0 || target >= parent.childCount) return
  const node = parent.child(index)
  const sibling = parent.child(target)
  const tr = e.state.tr
  let at: number
  if (dir < 0) {
    at = pos - sibling.nodeSize
    tr.replaceWith(at, pos + node.nodeSize, Fragment.from([node, sibling]))
  } else {
    at = pos + sibling.nodeSize
    tr.replaceWith(pos, pos + node.nodeSize + sibling.nodeSize, Fragment.from([sibling, node]))
  }
  e.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView())
  e.commands.focus()
}

export function canMove(e: Editor, pos: number, dir: -1 | 1): boolean {
  const $pos = e.state.doc.resolve(pos)
  const target = $pos.index() + dir
  return target >= 0 && target < $pos.parent.childCount
}
