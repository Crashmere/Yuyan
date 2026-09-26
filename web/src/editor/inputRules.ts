import { Extension, InputRule, nodeInputRule, textblockTypeInputRule, wrappingInputRule, type Editor } from '@tiptap/core'
import type { NodeType } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { normalizeLanguage } from '../schema/markdown'

// Markdown shortcuts beyond the ones each extension brings: the full-width characters a Chinese
// IME produces (＃ 》 ··· 【】 ￥), Obsidian callouts and Obsidian-style math delimiters.
export const MarkdownShortcuts = Extension.create<{ editMath: (editor: Editor, pos: number) => void }>({
  name: 'markdownShortcuts',

  addOptions() {
    return { editMath: () => {} }
  },

  addInputRules() {
    const n = this.editor.schema.nodes
    return [
      textblockTypeInputRule({ find: /^(＃{1,6})\s$/, type: n.heading, getAttributes: (m) => ({ level: m[1].length }) }),
      wrappingInputRule({ find: /^\s*([－＋＊])\s$/, type: n.bulletList }),
      wrappingInputRule({
        find: /^(\d+)[。．]\s$/,
        type: n.orderedList,
        getAttributes: (m) => ({ start: Number(m[1]) }),
        joinPredicate: (m, node) => node.childCount + node.attrs.start === Number(m[1]),
      }),
      wrappingInputRule({ find: /^\s*[》＞]\s$/, type: n.blockquote }),
      wrappingInputRule({ find: /^\s*[【［]([ xX]?)[】］]\s$/, type: n.taskItem, getAttributes: (m) => ({ checked: /x/i.test(m[1]) }) }),
      textblockTypeInputRule({
        find: /^(?:···|｀｀｀)([a-zA-Z0-9+#-]*)[\s\n]$/,
        type: n.codeBlock,
        getAttributes: (m) => ({ language: normalizeLanguage(m[1]) || null }),
      }),
      nodeInputRule({ find: /^(?:－－－|＿＿＿\s|＊＊＊\s)$/, type: n.horizontalRule }),
      calloutRule(),
      inlineMathRule(n.inlineMath),
      blockMathRule(n.blockMath, this.editor, this.options.editMath),
    ]
  },
})

// "[!note] " (or the full-width 【！note】) at the start of an empty paragraph becomes a callout.
// Inside a blockquote that holds only this paragraph, the blockquote itself is replaced.
function calloutRule() {
  return new InputRule({
    find: /^[[【][!！]([a-zA-Z-]+)[\]】]([+-]?)\s$/,
    handler: ({ state, range, match }) => {
      const $from = state.doc.resolve(range.from)
      if ($from.parent.textContent.length !== match[0].length - 1) return null
      const s = state.schema
      let depth = $from.depth
      if (depth > 1 && $from.node(depth - 1).type.name === 'blockquote' && $from.node(depth - 1).childCount === 1) depth -= 1
      const start = $from.before(depth)
      const end = $from.after(depth)
      const callout = s.nodes.callout.create({ type: match[1].toLowerCase(), fold: match[2] ?? '' }, [
        s.nodes.calloutTitle.create(),
        s.nodes.calloutContent.create(null, s.nodes.paragraph.create()),
      ])
      const { tr } = state
      tr.replaceWith(start, end, callout)
      tr.setSelection(TextSelection.create(tr.doc, start + 2))
    },
  })
}

// $x$ or ￥x￥ becomes inline math. Like Obsidian, the formula may not start or end with a space,
// which keeps prices such as "$5 and $6" as plain text.
function inlineMathRule(type: NodeType) {
  return new InputRule({
    find: /(?:^|[^$￥\\])([$￥])([^\s$￥](?:[^$￥\n]*[^\s$￥])?)([$￥])$/,
    handler: ({ state, range, match }) => {
      const [whole, open, latex, close] = match
      const start = range.from + whole.length - open.length - latex.length - close.length
      state.tr.replaceWith(start, range.to, type.create({ latex }))
    },
  })
}

// "$$ " at the start of an empty paragraph inserts a formula block and opens the formula editor.
function blockMathRule(type: NodeType, editor: Editor, editMath: (editor: Editor, pos: number) => void) {
  return new InputRule({
    find: /^[$￥]{2}\s$/,
    handler: ({ state, range }) => {
      const $from = state.doc.resolve(range.from)
      if ($from.parent.textContent.length !== 2) return null
      const start = $from.before()
      state.tr.replaceWith(start, $from.after(), type.create({ latex: '' }))
      setTimeout(() => editMath(editor, start))
    },
  })
}
