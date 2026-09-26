import type { Extensions } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import FileHandler from '@tiptap/extension-file-handler'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { CharacterCount, Dropcursor, Gapcursor, Placeholder, TrailingNode, UndoRedo } from '@tiptap/extensions'
import { Callout } from '../schema/callout'
import { schemaExtensions, YuyanImage } from '../schema/extensions'
import { assetURL, unassetURL } from '../shared/api'
import { CalloutKeys } from './calloutKeys'
import type { EditorUi } from './context'
import { MarkdownShortcuts } from './inputRules'
import { lowlight } from './lowlight'
import { MarkdownPaste } from './markdownPaste'
import { Search } from './search'
import { SlashCommand } from './slash'
import { TableShape } from './tables'
import { UiShortcuts } from './uiShortcuts'
import { insertImages, UploadPlaceholders } from './uploads'
import CalloutView from './views/CalloutView.vue'
import CodeBlockView from './views/CodeBlockView.vue'
import ImageView from './views/ImageView.vue'

export const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']

export function editorExtensions(ui: EditorUi): Extensions {
  const onMathClick = (_node: PMNode, pos: number) => ui.openMath(pos)
  return [
    ...schemaExtensions({
      codeBlock: CodeBlockLowlight.extend({
        addNodeView() {
          return VueNodeViewRenderer(CodeBlockView)
        },
      }).configure({ lowlight, defaultLanguage: null, enableTabIndentation: true, tabSize: 4 }),
      image: YuyanImage.extend({
        addNodeView() {
          return VueNodeViewRenderer(ImageView)
        },
      }).configure({ resolveSrc: assetURL, unresolveSrc: unassetURL }),
      inlineMath: InlineMath.configure({ katexOptions: { throwOnError: false }, onClick: onMathClick }),
      blockMath: BlockMath.configure({ katexOptions: { throwOnError: false }, onClick: onMathClick }),
      callout: Callout.extend({
        addNodeView() {
          return VueNodeViewRenderer(CalloutView)
        },
      }),
    }),
    UndoRedo,
    Dropcursor.configure({ width: 2, color: '#00b96b' }),
    Gapcursor,
    TrailingNode,
    // Count characters other than whitespace, as the reading view does.
    CharacterCount.configure({ textCounter: (text) => Array.from(text.replace(/\s/g, '')).length }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? '标题' : '输入 / 插入内容，也可以直接用 Markdown 语法'),
    }),
    FileHandler.configure({
      allowedMimeTypes: imageTypes,
      onPaste: (editor, files) => insertImages(editor, files),
      onDrop: (editor, files, pos) => insertImages(editor, files, pos),
    }),
    UploadPlaceholders,
    SlashCommand.configure({ ui }),
    MarkdownShortcuts.configure({ editMath: (_editor, pos) => ui.openMath(pos, true) }),
    MarkdownPaste,
    CalloutKeys,
    Search,
    TableShape,
    UiShortcuts.configure({ openLink: ui.openLink, openFind: ui.openFind, openShortcuts: ui.openShortcuts }),
  ]
}
