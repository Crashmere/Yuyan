import { mergeAttributes, type AnyExtension, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Code from '@tiptap/extension-code'
import CodeBlock from '@tiptap/extension-code-block'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { createColGroup, Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { Callout, CalloutContent, CalloutTitle } from './callout'
import { FoldBlock, FoldTitle, FoldContent, HighlightBlock } from './blockContainers'
import { withTitles } from './codeBlock'
import { AlignmentAttributes, blockAlignment, withCellAlignment } from './alignment'
import { imageFrame } from './imageStyle'
import { cropImageStyle, imageFrameStyle, parseRect, rect, rectText, storedCrop } from './imageGeometry'
import { Drawing } from './drawing'
import { Attachment } from './attachment'
import { Columns, Column } from './columns'
import { ImageBoard } from './imageBoard'
import { CellBackground, TextColor, TextHighlight } from './colors'
import { imageElement, withImageCaption } from './imageCaption'

// The document schema shared by the editor, the importer and the parity snapshots.
// Every node and mark here needs a matching case in internal/render/render.go.

export interface ImageOptions {
  inline: boolean
  allowBase64: boolean
  HTMLAttributes: Record<string, unknown>
  resize: false
  // Stored src values are app-relative (/assets/<id>.png); pages map them to the public prefix.
  resolveSrc: (src: string) => string
  unresolveSrc: (src: string) => string
}

export const YuyanImage = Image.extend<ImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
      HTMLAttributes: {},
      resize: false,
      resolveSrc: (src: string) => src,
      unresolveSrc: (src: string) => src,
    }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      alt: { default: null, parseHTML: (el: HTMLElement) => imageElement(el).getAttribute('alt') },
      title: { default: null, parseHTML: (el: HTMLElement) => imageElement(el).getAttribute('title') },
      width: { default: null, parseHTML: (el: HTMLElement) => Number(imageElement(el).getAttribute('width')) || null },
      height: { default: null, parseHTML: (el: HTMLElement) => Number(imageElement(el).getAttribute('height')) || null },
      caption: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-caption') || imageElement(el).getAttribute('data-caption') || null, rendered: false },
      src: {
        default: null,
        parseHTML: (el) => {
          const src = imageElement(el).getAttribute('src')
          return src ? this.options.unresolveSrc(src) : null
        },
      },
      shadow: {
        default: null,
        parseHTML: (el: HTMLElement) => imageElement(el).getAttribute('data-frame') === 'shadow' ? true : null,
        rendered: false,
      },
      crop: { default: null, parseHTML: (el: HTMLElement) => storedCrop(parseRect(imageElement(el).getAttribute('data-crop'), true)), rendered: false },
      placement: { default: null, parseHTML: (el: HTMLElement) => parseRect(imageElement(el).getAttribute('data-placement')), rendered: false },
      sourceWidth: { default: null, parseHTML: (el: HTMLElement) => Number(imageElement(el).getAttribute('data-source-width')) || null, rendered: false },
      sourceHeight: { default: null, parseHTML: (el: HTMLElement) => Number(imageElement(el).getAttribute('data-source-height')) || null, rendered: false },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-image-caption]', getAttrs: el => !!el.querySelector('img[src]:not([src^="data:"])') && null }, ...(this.parent?.() ?? [])]
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }
    if (typeof attrs.src === 'string') attrs.src = this.options.resolveSrc(attrs.src)
    const crop = storedCrop(node.attrs.crop), placement = rect(node.attrs.placement)
    const visual = node.attrs.caption ? { ...node.attrs, blockAlign: null, placement: placement ? { x: 0, y: 0, width: 1, height: 1 } : null } : node.attrs
    if (node.attrs.blockAlign) attrs['data-align'] = node.attrs.blockAlign
    if (crop || placement) {
      if (crop) attrs['data-crop'] = rectText(crop)
      if (placement) attrs['data-placement'] = rectText(placement)
      if (node.attrs.sourceWidth) attrs['data-source-width'] = node.attrs.sourceWidth
      if (node.attrs.sourceHeight) attrs['data-source-height'] = node.attrs.sourceHeight
      if (node.attrs.blockAlign) attrs['data-align'] = node.attrs.blockAlign
      if (node.attrs.shadow) attrs['data-frame'] = 'shadow'
      return withImageCaption(['span', mergeAttributes({ 'data-image-frame': '', style: imageFrameStyle(visual) }, placement ? {} : blockAlignment(visual.blockAlign, true), imageFrame(node.attrs.shadow)),
        ['img', mergeAttributes(this.options.HTMLAttributes, attrs, { style: cropImageStyle(crop) })]], node.attrs)
    }
    // Preserve source dimensions after resetting a crop as well, for a lossless HTML roundtrip.
    if (node.attrs.sourceWidth) attrs['data-source-width'] = node.attrs.sourceWidth
    if (node.attrs.sourceHeight) attrs['data-source-height'] = node.attrs.sourceHeight
    return withImageCaption(['img', mergeAttributes(this.options.HTMLAttributes, attrs, blockAlignment(visual.blockAlign, true), imageFrame(node.attrs.shadow))], node.attrs)
  },
})

// Tables render without Tiptap's colgroup and min-width unless their columns were given widths in
// the editor (editor/tables.ts); then they carry Tiptap's column group, as internal/render/render.go
// writes it. Wide tables scroll sideways (content.css).
export const YuyanTable = Table.extend({
  renderHTML({ node }) {
    let widths = false
    node.firstChild?.forEach((cell) => {
      if ((cell.attrs.colwidth as number[] | null)?.some(Boolean)) widths = true
    })
    const align = blockAlignment(node.attrs.blockAlign)
    if (!widths) return ['table', align, ['tbody', 0]]
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth)
    return ['table', mergeAttributes({ style: tableWidth ? `width: ${tableWidth}` : `min-width: ${tableMinWidth}` }, align), colgroup!, ['tbody', 0]]
  },
})

// A row can be given a height in the editor (editor/tables.ts).
export const YuyanTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => parseInt(el.style.height, 10) || null,
        renderHTML: (attrs: Record<string, unknown>) => (attrs.height ? { style: `height: ${attrs.height}px` } : {}),
      },
    }
  },
})

export interface SchemaOverrides {
  codeBlock?: AnyExtension
  image?: AnyExtension
  inlineMath?: AnyExtension
  blockMath?: AnyExtension
  callout?: AnyExtension
  table?: AnyExtension
  drawing?: AnyExtension
  attachment?: AnyExtension
  imageBoard?: AnyExtension
  foldBlock?: AnyExtension
  columns?: AnyExtension
}

export function schemaExtensions(o: SchemaOverrides = {}): Extensions {
  return [
    AlignmentAttributes,
    TextColor,
    CellBackground,
    StarterKit.configure({
      code: false,
      codeBlock: false,
      undoRedo: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: null, rel: null, class: null },
      },
    }),
    // Obsidian notes use bold or linked inline code, which Tiptap's default code mark forbids.
    Code.extend({ excludes: '' }),
    o.codeBlock ?? withTitles(CodeBlock),
    o.image ?? YuyanImage,
    o.imageBoard ?? ImageBoard,
    o.attachment ?? Attachment,
    o.drawing ?? Drawing,
    TextHighlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    o.table ?? YuyanTable.configure({ resizable: false }),
    YuyanTableRow,
    withCellAlignment(TableHeader),
    withCellAlignment(TableCell),
    o.callout ?? Callout,
    CalloutTitle,
    CalloutContent,
    o.foldBlock ?? FoldBlock,
    FoldTitle,
    FoldContent,
    HighlightBlock,
    o.columns ?? Columns,
    Column,
    o.inlineMath ?? InlineMath,
    o.blockMath ?? BlockMath,
  ]
}
