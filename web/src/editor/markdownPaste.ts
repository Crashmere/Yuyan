import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { markdownToDoc } from '../schema/markdown'

const blockSyntax = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~|\|.*\||\s*[-*]\s\[[ xX]\]\s|\$\$|<(?:details|div)\b[^>]*data-(?:fold|highlight)-block)/m
const inlineSyntax = /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`|==[^=\n]+==|!\[\[[^\]\n]+\]\]/

// Pasting plain text that looks like Markdown inserts formatted content instead of raw symbols.
// Clipboard HTML (from web pages and most apps) is left to Tiptap's own HTML parsing.
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain')
            if (!text || event.clipboardData?.getData('text/html')) return false
            if (view.state.selection.$from.parent.type.spec.code) return false
            if (!blockSyntax.test(text) && !inlineSyntax.test(text)) return false
            const doc = markdownToDoc(text, { breaks: true })
            return editor.chain().focus().insertContent(doc.content ?? []).run()
          },
        },
      }),
    ]
  },
})
