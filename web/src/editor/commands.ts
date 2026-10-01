import type { Component } from 'vue'
import type { Editor } from '@tiptap/core'
import {
  Bold, Code, Columns2, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, Highlighter, Image, Italic, Link, List, ListOrdered,
  ListTodo, MessageSquareText, Minus, Pilcrow, Quote, Radical, Sigma, SquareCode, Strikethrough, Table, Underline, Workflow, PanelTopClose, Square,
} from 'lucide-vue-next'
import type { EditorUi } from './context'
import { clearSelectedTextFormatting, setSelectedTextStyle, textStyleActive, toggleSelectedTextMark } from './textSelection'
import { insertColumns } from './columns'
import { insertContainer } from './blockContainers'

// Commands shared by the toolbar, the selection toolbar, the slash menu. Every
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
  { id: 'p', label: '正文', icon: Pilcrow, shortcut: 'Mod-Alt-0', active: (e) => textStyleActive(e, 0), apply: (e) => { if (!setSelectedTextStyle(e, 0)) e.chain().focus().setParagraph().run() } },
  ...headingIcons.map((icon, i) => {
    const level = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6
    return {
      id: `h${level}`,
      label: `标题 ${level}`,
      icon,
      shortcut: `Mod-Alt-${level}`,
      active: (e: Editor) => textStyleActive(e, level),
      apply: (e: Editor) => { if (!setSelectedTextStyle(e, level)) e.chain().focus().setHeading({ level }).run() },
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

const textMarkButtons: MarkButton[] = [
  { name: 'bold', label: '粗体', icon: Bold, shortcut: 'Mod-B', toggle: (e) => e.chain().focus().toggleBold().run() },
  { name: 'italic', label: '斜体', icon: Italic, shortcut: 'Mod-I', toggle: (e) => e.chain().focus().toggleItalic().run() },
  { name: 'strike', label: '删除线', icon: Strikethrough, shortcut: 'Mod-Shift-X', toggle: (e) => e.chain().focus().toggleStrike().run() },
  { name: 'underline', label: '下划线', icon: Underline, shortcut: 'Mod-U', toggle: (e) => e.chain().focus().toggleUnderline().run() },
  { name: 'code', label: '行内代码', icon: Code, shortcut: 'Mod-E', toggle: (e) => e.chain().focus().toggleCode().run() },
  { name: 'highlight', label: '高亮', icon: Highlighter, shortcut: 'Mod-Shift-H', toggle: (e) => e.chain().focus().toggleHighlight().run() },
]
export const markButtons = textMarkButtons.map(button => ({ ...button, toggle: (e: Editor) => { if (!toggleSelectedTextMark(e, button.name)) button.toggle(e) } }))

export const listButtons: MarkButton[] = [
  { name: 'bulletList', label: '无序列表', icon: List, shortcut: 'Mod-Shift-8', toggle: (e) => e.chain().focus().toggleBulletList().run() },
  { name: 'orderedList', label: '有序列表', icon: ListOrdered, shortcut: 'Mod-Shift-7', toggle: (e) => e.chain().focus().toggleOrderedList().run() },
  { name: 'taskList', label: '任务列表', icon: ListTodo, shortcut: 'Mod-Shift-9', toggle: (e) => e.chain().focus().toggleTaskList().run() },
]

export function clearFormatting(e: Editor) {
  if (!clearSelectedTextFormatting(e)) e.chain().focus().unsetAllMarks().run()
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
  // Fixed menu labels use explicit syllables, in the same format as the server's title index.
  pinyin: string
  syntax?: string[]
  keywords: string
  run: (e: Editor, ui: EditorUi, anchor?: DOMRect) => void
}

export const insertItems: InsertItem[] = [
  { id: 'p', label: '正文', description: '普通段落', icon: Pilcrow, group: '基础', pinyin: 'zheng wen', keywords: 'zw text paragraph', run: (e) => e.chain().focus().setParagraph().run() },
  { id: 'h1', label: '标题 1', description: '大标题', icon: Heading1, group: '基础', markdown: '#', pinyin: 'biao ti 1', keywords: 'bt1 h1 heading', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: '标题 2', description: '中标题', icon: Heading2, group: '基础', markdown: '##', pinyin: 'biao ti 2', keywords: 'bt2 h2 heading', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: '标题 3', description: '小标题', icon: Heading3, group: '基础', markdown: '###', pinyin: 'biao ti 3', keywords: 'bt3 h3 heading', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'bullet', label: '无序列表', description: '圆点列表', icon: List, group: '列表', markdown: '-', syntax: ['*', '+'], pinyin: 'wu xu lie biao', keywords: 'wxlb bullet list ul', run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: '有序列表', description: '带编号的列表', icon: ListOrdered, group: '列表', markdown: '1.', syntax: ['1)'], pinyin: 'you xu lie biao', keywords: 'yxlb ordered list ol', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'task', label: '任务列表', description: '可勾选的待办', icon: ListTodo, group: '列表', markdown: '[ ]', syntax: ['- [ ]', '[x]', '- [x]'], pinyin: 'ren wu lie biao', keywords: 'rwlb todo task', run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: '引用', description: '引用一段话', icon: Quote, group: '插入', markdown: '>', pinyin: 'yin yong', keywords: 'yy quote blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'columns', label: '分栏', description: '并排排列内容，可调整为 2–4 栏', icon: Columns2, group: '插入', pinyin: 'fen lan', keywords: 'fl columns layout', run: e => { insertColumns(e) } },
  { id: 'foldBlock', label: '折叠块', description: '带标题、可以展开或收起的内容', icon: PanelTopClose, group: '插入', syntax: ['<details>'], pinyin: 'zhe die kuai', keywords: 'fold collapse toggle details', run: e => { insertContainer(e, 'foldBlock') } },
  { id: 'highlightBlock', label: '高亮块', description: '用柔和底色突出一段内容', icon: Square, group: '插入', pinyin: 'gao liang kuai', keywords: 'highlight background color', run: e => { insertContainer(e, 'highlightBlock') } },
  { id: 'code', label: '代码块', description: '带语法高亮的代码', icon: SquareCode, group: '插入', markdown: '```', syntax: ['~~~'], pinyin: 'dai ma kuai', keywords: 'dmk code', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  {
    id: 'titledCode', label: '带标题的代码块', description: '有标题栏，可以收起', icon: SquareCode, group: '插入', syntax: ['```', '~~~', '``` title=', '~~~ title='], pinyin: 'dai biao ti de dai ma kuai', keywords: 'dbtddmk btdmk code title',
    run: (e) => e.chain().focus().toggleCodeBlock().updateAttributes('codeBlock', { title: '', titleHidden: false }).run(),
  },
  {
    id: 'mermaid', label: 'Mermaid 图表', description: '用文字画流程图、时序图', icon: Workflow, group: '插入', markdown: '```mermaid', syntax: ['~~~mermaid'], pinyin: 'mermaid tu biao', keywords: 'mermaid tb chart diagram lct',
    run: (e) => e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\n  A[开始] --> B[结束]' }] }).run(),
  },
  { id: 'table', label: '表格', description: '选择行数和列数', icon: Table, group: '插入', syntax: ['|'], pinyin: 'biao ge', keywords: 'bg table', run: (e, ui, anchor) => ui.openTableGrid(anchor ?? coordsRect(e)) },
  { id: 'image', label: '图片', description: '上传图片，也可以直接粘贴或拖入', icon: Image, group: '插入', syntax: ['![]()'], pinyin: 'tu pian', keywords: 'tp image picture', run: (_e, ui) => ui.pickImage() },
  { id: 'link', label: '链接', description: '网址或本站文档的链接', icon: Link, group: '插入', syntax: ['[]()'], pinyin: 'lian jie', keywords: 'lj link url', run: (_e, ui) => ui.openLink() },
  { id: 'hr', label: '分割线', description: '分隔上下内容', icon: Minus, group: '插入', markdown: '---', syntax: ['***', '___'], pinyin: 'fen ge xian', keywords: 'fgx hr divider', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'blockMath', label: '公式块', description: '独占一行的 LaTeX 公式', icon: Sigma, group: '插入', markdown: '$$', pinyin: 'gong shi kuai', keywords: 'gsk math formula latex', run: (e, ui) => insertMath(e, ui, 'blockMath') },
  { id: 'inlineMath', label: '行内公式', description: '嵌在文字中的公式', icon: Radical, group: '插入', markdown: '$…$', pinyin: 'hang/xing nei gong shi', keywords: 'hngs inline math', run: (e, ui) => insertMath(e, ui, 'inlineMath') },
  { id: 'note', label: '提示', description: 'Callout：提示', icon: MessageSquareText, group: '提示块', markdown: '[!note]', syntax: ['> [!note]'], pinyin: 'ti shi', keywords: 'ts callout note', run: (e) => insertCallout(e, 'note') },
  { id: 'tip', label: '技巧', description: 'Callout：技巧', icon: MessageSquareText, group: '提示块', markdown: '[!tip]', syntax: ['> [!tip]'], pinyin: 'ji qiao', keywords: 'jq callout tip', run: (e) => insertCallout(e, 'tip') },
  { id: 'warning', label: '警告', description: 'Callout：警告', icon: MessageSquareText, group: '提示块', markdown: '[!warning]', syntax: ['> [!warning]'], pinyin: 'jing gao', keywords: 'jg callout warning', run: (e) => insertCallout(e, 'warning') },
]

export function coordsRect(e: Editor): DOMRect {
  const c = e.view.coordsAtPos(e.state.selection.from)
  return new DOMRect(c.left, c.top, 1, c.bottom - c.top)
}
