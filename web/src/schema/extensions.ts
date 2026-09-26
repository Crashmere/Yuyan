import { mergeAttributes, type AnyExtension, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Code from '@tiptap/extension-code'
import CodeBlock from '@tiptap/extension-code-block'
import Image from '@tiptap/extension-image'
import Highlight from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { Callout, CalloutContent, CalloutTitle } from './callout'

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
      src: {
        default: null,
        parseHTML: (el) => {
          const src = el.getAttribute('src')
          return src ? this.options.unresolveSrc(src) : null
        },
      },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }
    if (typeof attrs.src === 'string') attrs.src = this.options.resolveSrc(attrs.src)
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
  },
})

// Tables render without Tiptap's colgroup/min-width styling; wide tables scroll via CSS.
export const YuyanTable = Table.extend({
  renderHTML() {
    return ['table', {}, ['tbody', 0]]
  },
})

export interface SchemaOverrides {
  codeBlock?: AnyExtension
  image?: AnyExtension
  inlineMath?: AnyExtension
  blockMath?: AnyExtension
  callout?: AnyExtension
}

export function schemaExtensions(o: SchemaOverrides = {}): Extensions {
  return [
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
    o.codeBlock ?? CodeBlock,
    o.image ?? YuyanImage,
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    YuyanTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    o.callout ?? Callout,
    CalloutTitle,
    CalloutContent,
    o.inlineMath ?? InlineMath,
    o.blockMath ?? BlockMath,
  ]
}
