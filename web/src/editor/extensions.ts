import type { Editor, Extensions } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import FileHandler from '@tiptap/extension-file-handler'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { CharacterCount, Dropcursor, Gapcursor, Placeholder, TrailingNode, UndoRedo } from '@tiptap/extensions'
import { common, createLowlight } from 'lowlight'
import { Callout } from '../schema/callout'
import { schemaExtensions, YuyanImage } from '../schema/extensions'
import { assetURL, unassetURL, uploadImage } from '../shared/api'
import { CalloutKeys } from './calloutKeys'
import { MarkdownShortcuts } from './inputRules'
import { MarkdownPaste } from './markdownPaste'
import { SlashCommand, type SlashItem } from './slash'
import { notify } from './toast'
import CalloutView from './views/CalloutView.vue'
import CodeBlockView from './views/CodeBlockView.vue'

const lowlight = createLowlight(common)
const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']

let current: Editor | null = null

// editMath edits the formula node at pos with a simple prompt; an empty answer removes it.
export function editMath(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || (node.type.name !== 'inlineMath' && node.type.name !== 'blockMath')) return
  const latex = window.prompt('编辑公式（LaTeX）', node.attrs.latex ?? '')
  if (latex === null) return
  const chain = editor.chain().focus()
  if (!latex.trim()) {
    chain.deleteRange({ from: pos, to: pos + node.nodeSize }).run()
  } else if (node.type.name === 'inlineMath') {
    chain.updateInlineMath({ latex, pos }).run()
  } else {
    chain.updateBlockMath({ latex, pos }).run()
  }
}

export async function insertImages(editor: Editor, files: File[], pos?: number) {
  for (const file of files) {
    notify(`正在上传 ${file.name || '图片'}…`, 0)
    try {
      const asset = await uploadImage(file)
      const node = { type: 'image', attrs: { src: asset.url, alt: null, title: null, width: null, height: null } }
      if (pos !== undefined) editor.chain().insertContentAt(pos, node).run()
      else editor.chain().focus().insertContent(node).run()
      notify('图片已上传')
    } catch (e) {
      notify(`图片上传失败：${e instanceof Error ? e.message : e}。可以重新粘贴或拖入。`, 8000)
    }
  }
}

function insertCallout(type: string) {
  return (editor: Editor) =>
    editor.chain().focus().insertContent({
      type: 'callout',
      attrs: { type, fold: '' },
      content: [{ type: 'calloutTitle' }, { type: 'calloutContent', content: [{ type: 'paragraph' }] }],
    }).run()
}

function insertMath(kind: 'inlineMath' | 'blockMath') {
  return (editor: Editor) => {
    const latex = window.prompt('输入公式（LaTeX）')
    if (!latex?.trim()) return
    if (kind === 'inlineMath') editor.chain().focus().insertInlineMath({ latex }).run()
    else editor.chain().focus().insertBlockMath({ latex }).run()
  }
}

export function slashItems(pickImage: () => void): SlashItem[] {
  return [
    { title: '正文', hint: '', keywords: 'zw text paragraph', run: (e) => e.chain().focus().setParagraph().run() },
    { title: '标题 1', hint: '#', keywords: 'bt1 h1 heading', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
    { title: '标题 2', hint: '##', keywords: 'bt2 h2 heading', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { title: '标题 3', hint: '###', keywords: 'bt3 h3 heading', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { title: '无序列表', hint: '-', keywords: 'wxlb bullet list ul', run: (e) => e.chain().focus().toggleBulletList().run() },
    { title: '有序列表', hint: '1.', keywords: 'yxlb ordered list ol', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { title: '任务列表', hint: '[ ]', keywords: 'rwlb todo task', run: (e) => e.chain().focus().toggleTaskList().run() },
    { title: '引用', hint: '>', keywords: 'yy quote blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { title: '代码块', hint: '```', keywords: 'dmk code', run: (e) => e.chain().focus().toggleCodeBlock().run() },
    {
      title: 'Mermaid 图表', hint: '', keywords: 'mermaid tb chart diagram lct',
      run: (e) => e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\n  A[开始] --> B[结束]' }] }).run(),
    },
    { title: '公式块', hint: '$$', keywords: 'gsk math formula latex', run: insertMath('blockMath') },
    { title: '行内公式', hint: '$…$', keywords: 'hngs inline math', run: insertMath('inlineMath') },
    { title: '表格', hint: '', keywords: 'bg table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { title: '分割线', hint: '---', keywords: 'fgx hr divider', run: (e) => e.chain().focus().setHorizontalRule().run() },
    { title: '图片', hint: '', keywords: 'tp image picture', run: () => pickImage() },
    { title: '提示 Callout', hint: '[!note]', keywords: 'ts callout note', run: insertCallout('note') },
    { title: '技巧 Callout', hint: '[!tip]', keywords: 'jq callout tip', run: insertCallout('tip') },
    { title: '警告 Callout', hint: '[!warning]', keywords: 'jg callout warning', run: insertCallout('warning') },
    { title: '代码 Callout', hint: '[!code]', keywords: 'dm callout code', run: insertCallout('code') },
  ]
}

export function editorExtensions(pickImage: () => void): Extensions {
  const onMathClick = (_node: PMNode, pos: number) => current && editMath(current, pos)
  return [
    ...schemaExtensions({
      codeBlock: CodeBlockLowlight.extend({
        addNodeView() {
          return VueNodeViewRenderer(CodeBlockView)
        },
      }).configure({ lowlight, defaultLanguage: null }),
      image: YuyanImage.configure({ resolveSrc: assetURL, unresolveSrc: unassetURL }),
      inlineMath: InlineMath.configure({ katexOptions: { throwOnError: false }, onClick: onMathClick }),
      blockMath: BlockMath.configure({ katexOptions: { throwOnError: false }, onClick: onMathClick }),
      callout: Callout.extend({
        addNodeView() {
          return VueNodeViewRenderer(CalloutView)
        },
      }),
    }),
    UndoRedo,
    Dropcursor.configure({ width: 2, color: '#2f7de1' }),
    Gapcursor,
    TrailingNode,
    CharacterCount,
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? '标题' : '输入 / 插入内容，也可以直接用 Markdown 语法'),
    }),
    FileHandler.configure({
      allowedMimeTypes: imageTypes,
      onPaste: (editor, files) => insertImages(editor, files),
      onDrop: (editor, files, pos) => insertImages(editor, files, pos),
    }),
    SlashCommand.configure({ items: slashItems(pickImage) }),
    MarkdownShortcuts.configure({ editMath }),
    MarkdownPaste,
    CalloutKeys,
  ]
}

export function setCurrentEditor(editor: Editor | null) {
  current = editor
}
