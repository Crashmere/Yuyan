import type { Extensions } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlock from '@tiptap/extension-code-block'
import FileHandler from '@tiptap/extension-file-handler'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { CharacterCount, Dropcursor, Gapcursor, Placeholder, TrailingNode, UndoRedo } from '@tiptap/extensions'
import { Callout } from '../schema/callout'
import { withTitles } from '../schema/codeBlock'
import { schemaExtensions, YuyanImage, YuyanTable } from '../schema/extensions'
import { assetURL, unassetURL } from '../shared/api'
import { CalloutKeys } from './calloutKeys'
import { openCollapsedCode } from './codeBlocks'
import type { EditorUi } from './context'
import { ImageSizeStore } from './images'
import { ImageKeys } from './imageKeys'
import { ImageBreaks } from './imageBreaks'
import { BlockSpaces } from './blockSpaces'
import { MarkdownShortcuts } from './inputRules'
import { codeNodeView } from './codeNodeView'
import { MarkdownPaste } from './markdownPaste'
import { Search } from './search'
import { SlashCommand } from './slash'
import { SelectWithin } from './selectWithin'
import { fixColumnWidths, followColumnBorder, FramedTableView, TableShape } from './tables'
import { resizeHitWidth, rowResizing, withResizeDelay } from './tableResize'
import { tableControls } from './tableControls'
import { UiShortcuts } from './uiShortcuts'
import { insertImages, UploadPlaceholders } from './uploads'
import CalloutView from './views/CalloutView.vue'
import ImageView from './views/ImageView.vue'
import ImageBoardView from './views/ImageBoardView.vue'
import { ImageBoard } from '../schema/imageBoard'

export const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']

export function editorExtensions(ui: EditorUi): Extensions {
  const onMathClick = (_node: PMNode, pos: number) => ui.openMath(pos)
  return [
    ...schemaExtensions({
      imageBoard: ImageBoard.extend({
        addOptions() { return { ui } },
        addNodeView() { return VueNodeViewRenderer(ImageBoardView) },
      }),
      codeBlock: withTitles(CodeBlock)
        .extend({
          addNodeView() {
            return codeNodeView
          },
          addProseMirrorPlugins() {
            return [...(this.parent?.() ?? []), openCollapsedCode]
          },
        })
        .configure({ defaultLanguage: null, enableTabIndentation: true, tabSize: 4 }),
      // Column and row borders drag to resize; fixColumnWidths runs before prosemirror-tables' own
      // column resizing (tables.ts). Wide tables sit in the same frame as on reading pages.
      table: YuyanTable.extend({
        addProseMirrorPlugins() {
          return [fixColumnWidths, followColumnBorder, rowResizing(), tableControls(), ...(this.parent?.() ?? []).map(withResizeDelay)]
        },
      }).configure({ resizable: true, handleWidth: resizeHitWidth, View: FramedTableView }),
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
    ImageSizeStore,
    ImageKeys,
    ImageBreaks,
    BlockSpaces,
    SlashCommand.configure({ ui }),
    MarkdownShortcuts.configure({ editMath: (_editor, pos) => ui.openMath(pos, true) }),
    MarkdownPaste,
    CalloutKeys,
    Search,
    TableShape,
    SelectWithin,
    UiShortcuts.configure({ openFind: ui.openFind }),
  ]
}
