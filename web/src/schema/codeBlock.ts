import type { JSONContent, Node } from '@tiptap/core'

// Code blocks as in Yuque: an optional title bar with a title, and whether the block starts
// collapsed. title null means no title bar; '' shows the bar without a title. A collapsed block
// needs its bar to open again, so collapsed implies a title. Blocks without a bar keep their old
// HTML; titled ones are wrapped as
//   <div class="code-block[ is-collapsed]"><div class="code-title">…</div><pre>…</pre></div>
// which internal/render writes the same way.
export function withTitles<T extends Node>(base: T) {
  return base.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        title: {
          default: null,
          rendered: false,
          parseHTML: (el: HTMLElement) => (el.matches('div.code-block') ? (el.querySelector(':scope > .code-title')?.textContent ?? '') : null),
        },
        collapsed: {
          default: false,
          rendered: false,
          parseHTML: (el: HTMLElement) => el.matches('div.code-block.is-collapsed'),
        },
      }
    },
    parseHTML() {
      return [
        {
          tag: 'div.code-block',
          preserveWhitespace: 'full',
          contentElement: 'pre',
          getAttrs: (el: HTMLElement) => ({ language: /(?:^|\s)language-(\S+)/.exec(el.querySelector('pre > code')?.className ?? '')?.[1] ?? null }),
        },
        ...(this.parent?.() ?? []),
      ]
    },
    renderHTML(props) {
      const pre = this.parent!(props)
      const { title, collapsed } = props.node.attrs
      if (typeof title !== 'string') return pre
      return ['div', { class: collapsed ? 'code-block is-collapsed' : 'code-block' }, ['div', { class: 'code-title' }, title], pre]
    },
  })
}

// A [!code] callout, which the notes used in Obsidian to imitate Yuque's titled, collapsible code
// blocks, as the code block it stands for: the callout title becomes the block's title and the fold
// marker "-" keeps it collapsed; untitled callouts that were not collapsed become plain blocks.
// null for callouts that do not hold exactly one code block.
export function codeFromCallout(callout: JSONContent): JSONContent | null {
  const [title, body] = callout.content ?? []
  const blocks = body?.content ?? []
  if (callout.type !== 'callout' || callout.attrs?.type !== 'code' || blocks.length !== 1 || blocks[0].type !== 'codeBlock') return null
  const text = (title?.content ?? []).map((n) => n.text ?? '').join('').trim()
  const collapsed = callout.attrs?.fold === '-'
  return { ...blocks[0], attrs: { ...blocks[0].attrs, title: text || collapsed ? text : null, collapsed } }
}

// The title and collapsed state in a Markdown fence after the language, e.g. ```cpp title="家谱树"
// collapsed. Obsidian reads only the language and shows a plain code block. Markdown decodes
// escapes and entities in this line (remark writes the backslashes that need it), so a title keeps
// its quotes by choosing the other kind, or &quot; when it has both, and protects an & that would
// read as an entity.
export function codeMeta(title: unknown, collapsed: unknown): string | null {
  if (typeof title !== 'string') return null
  let text = title.replace(/&(?=#?\w+;)/g, '&amp;')
  let quote = '"'
  if (text.includes('"')) {
    if (text.includes("'")) text = text.replace(/"/g, '&quot;')
    else quote = "'"
  }
  return `title=${quote}${text}${quote}${collapsed ? ' collapsed' : ''}`
}

// Reads codeMeta's form, as Markdown hands it over decoded, and a title among other settings.
export function parseCodeMeta(meta: string | null | undefined): { title: string | null; collapsed: boolean } {
  const exact = /^title=(["'])(.*)\1( collapsed)?$/.exec(meta ?? '')
  if (exact) return { title: exact[2], collapsed: !!exact[3] }
  const m = /(?:^|\s)title=(["'])(.*?)\1/.exec(meta ?? '')
  if (!m) return { title: null, collapsed: false }
  return { title: m[2], collapsed: /(?:^|\s)collapsed(?:\s|$)/.test((meta ?? '').replace(m[0], ' ')) }
}
