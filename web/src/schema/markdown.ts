import { getSchema, type Extensions, type JSONContent } from '@tiptap/core'
import { DOMParser as SchemaParser, type Schema } from '@tiptap/pm/model'
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string'
import type {
  Blockquote, Code, Html, List, ListItem, Nodes, Paragraph, PhrasingContent, Root, RootContent, Table,
} from 'mdast'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkStringify from 'remark-stringify'
import { codeFromCallout, codeMeta, parseCodeMeta } from './codeBlock'
import { schemaExtensions } from './extensions'
import { alignment } from './alignment'
import { remarkStrong } from './strong'

// Markdown <-> Tiptap JSON using remark, with Obsidian's extensions: callouts, ==highlight==,
// [[wiki links]], ![[embeds]], image sizes (![alt|300](src)) and single-newline line breaks.
// Code block titles and collapsed state travel in the fence (```cpp title="…" collapsed); the
// [!code] callouts once used in Obsidian for them are read as titled code blocks. Tables Markdown
// cannot hold (column widths, row heights, merged cells), and aligned paragraphs/images, are
// written as HTML and read back.

export interface ImportContext {
  // For auditing old imports against their original source. New imports/pastes accept
  // punctuation next to ** without requiring spaces around Chinese text.
  strictStrong?: boolean
  // Obsidian treats a single newline inside a paragraph as a line break unless "strict line breaks" is on.
  breaks?: boolean
  resolveImage?: (target: string, kind: 'markdown' | 'wiki' | 'html') => string | null
  resolveLink?: (target: string, kind: 'wiki' | 'markdown') => string | null
  issue?: (message: string) => void
}

type Mark = NonNullable<JSONContent['marks']>[number]

// A text node may carry each mark type once: nested emphasis keeps the outer mark, and an inner
// link replaces an outer one.
function withMark(marks: Mark[], mark: Mark): Mark[] {
  if (!marks.some((m) => m.type === mark.type)) return [...marks, mark]
  return mark.type === 'link' ? [...marks.filter((m) => m.type !== 'link'), mark] : marks
}

const calloutMarker = /^\[!([\w-]+)\]([+-]?)[ \t]*/

export function markdownToDoc(markdown: string, ctx: ImportContext = {}): JSONContent {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  if (!ctx.strictStrong) parser.use(remarkStrong)
  const tree = parser.parse(markdown) as Root
  const defs = new Map<string, { url: string; title?: string | null }>()
  collectDefinitions(tree, defs)
  const content = new Converter(ctx, defs).blocks(tree.children)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

function collectDefinitions(node: Nodes, defs: Map<string, { url: string; title?: string | null }>) {
  if (node.type === 'definition') defs.set(node.identifier.toLowerCase(), { url: node.url, title: node.title })
  if ('children' in node) for (const c of node.children) collectDefinitions(c as Nodes, defs)
}

class Converter {
  constructor(
    private ctx: ImportContext,
    private defs: Map<string, { url: string; title?: string | null }>,
  ) {}

  private issue(msg: string) {
    this.ctx.issue?.(msg)
  }

  blocks(nodes: RootContent[]): JSONContent[] {
    const out: JSONContent[] = []
    for (const n of nodes) out.push(...this.block(n))
    return out
  }

  private block(n: RootContent): JSONContent[] {
    switch (n.type) {
      case 'paragraph':
        return this.paragraph(n.children)
      case 'heading':
        return [{ type: 'heading', attrs: { level: n.depth }, ...content(this.inline(n.children, [])) }]
      case 'thematicBreak':
        return [{ type: 'horizontalRule' }]
      case 'blockquote':
        return [this.blockquote(n)]
      case 'list':
        return [this.list(n)]
      case 'code':
        return [this.code(n)]
      case 'math':
        return [{ type: 'blockMath', attrs: { latex: cleanLatex(n.value) } }]
      case 'table':
        return [this.table(n)]
      case 'html':
        return this.htmlBlock(n)
      case 'definition':
        return []
      case 'footnoteDefinition':
        this.issue(`脚注 [^${n.identifier}] 按普通段落导入`)
        return [{ type: 'paragraph', content: [{ type: 'text', text: `[^${n.identifier}]: ` }] }, ...this.blocks(n.children)]
      default:
        this.issue(`不支持的块 ${n.type}，已跳过`)
        return []
    }
  }

  // A paragraph that only contains images stays a paragraph; images are inline, as in Markdown.
  // A paragraph holding nothing but one multi-line $...$ formula (Obsidian accepts align
  // environments there) becomes a formula block.
  private paragraph(children: PhrasingContent[]): JSONContent[] {
    const inline = this.inline(children, [])
    if (!inline.length) return []
    const solid = inline.filter((n) => n.type !== 'hardBreak' && !(n.type === 'text' && !n.text?.trim()))
    if (solid.length === 1 && solid[0].type === 'inlineMath' && /\n|\\begin\{/.test(String(solid[0].attrs?.latex))) {
      return [{ type: 'blockMath', attrs: { latex: String(solid[0].attrs?.latex).trim() } }]
    }
    return [{ type: 'paragraph', content: inline }]
  }

  private blockquote(n: Blockquote): JSONContent {
    const first = n.children[0]
    if (first?.type === 'paragraph' && first.children[0]?.type === 'text') {
      const m = calloutMarker.exec(first.children[0].value)
      if (m) return this.callout(n, first, m)
    }
    const inner = this.blocks(n.children)
    return { type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] }
  }

  private callout(n: Blockquote, first: Paragraph, m: RegExpExecArray): JSONContent {
    const [head, ...restInline] = first.children
    const text = (head as { value: string }).value.slice(m[0].length)
    const inlineAll: PhrasingContent[] = [...(text ? [{ type: 'text', value: text } as PhrasingContent] : []), ...restInline]
    // The title is the rest of the first line; anything after the first newline is body text.
    const titleNodes: PhrasingContent[] = []
    const bodyNodes: PhrasingContent[] = []
    let inBody = false
    for (const node of inlineAll) {
      if (inBody) {
        bodyNodes.push(node)
        continue
      }
      if (node.type === 'text' && node.value.includes('\n')) {
        const i = node.value.indexOf('\n')
        if (i > 0) titleNodes.push({ type: 'text', value: node.value.slice(0, i) })
        const after = node.value.slice(i + 1)
        if (after) bodyNodes.push({ type: 'text', value: after })
        inBody = true
      } else if (node.type === 'break') {
        inBody = true
      } else {
        titleNodes.push(node)
      }
    }
    const title = this.inline(trimPhrasing(titleNodes), [])
    const body = [...(bodyNodes.length ? this.paragraph(bodyNodes) : []), ...this.blocks(n.children.slice(1))]
    const callout: JSONContent = {
      type: 'callout',
      attrs: { type: m[1].toLowerCase(), fold: m[2] },
      content: [
        { type: 'calloutTitle', ...content(title) },
        { type: 'calloutContent', content: body.length ? body : [{ type: 'paragraph' }] },
      ],
    }
    return codeFromCallout(callout) ?? callout
  }

  private list(n: List): JSONContent {
    const task = n.children.some((i) => i.checked !== null && i.checked !== undefined)
    if (task) {
      return { type: 'taskList', content: n.children.map((i) => ({ type: 'taskItem', attrs: { checked: !!i.checked }, content: this.itemBlocks(i) })) }
    }
    const items = n.children.map((i) => ({ type: 'listItem', content: this.itemBlocks(i) }))
    if (n.ordered) return { type: 'orderedList', attrs: { start: n.start ?? 1, type: null }, content: items }
    return { type: 'bulletList', content: items }
  }

  private itemBlocks(i: ListItem): JSONContent[] {
    const blocks = this.blocks(i.children)
    // list items must start with a paragraph
    if (!blocks.length || blocks[0].type !== 'paragraph') blocks.unshift({ type: 'paragraph' })
    return blocks
  }

  private code(n: Code): JSONContent {
    const language = normalizeLanguage(n.lang ?? '')
    const { title, collapsed } = parseCodeMeta(n.meta)
    const node: JSONContent = { type: 'codeBlock', attrs: { language: language || null, ...(title !== null ? { title, collapsed } : {}) } }
    if (n.value) node.content = [{ type: 'text', text: n.value }]
    return node
  }

  private table(n: Table): JSONContent {
    return {
      type: 'table',
      content: n.children.map((row, r) => ({
        type: 'tableRow',
        content: row.children.map((cell, c) => {
          const inline = this.inline(cell.children, [])
          return {
            type: r === 0 ? 'tableHeader' : 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null, align: n.align?.[c] ?? null },
            content: [{ type: 'paragraph', ...content(inline) }],
          }
        }),
      })),
    }
  }

  private htmlBlock(n: Html): JSONContent[] {
    const blocks = /^\s*<(?:table|p)[\s>]/i.test(n.value) ? this.htmlBlocks(n.value) : null
    if (blocks?.length) return blocks
    const inline = this.inlineHtml(n.value)
    if (inline) return inline.length ? [{ type: 'paragraph', content: inline }] : []
    if (n.value.trim().startsWith('<!--')) return []
    if (isHtmlTag(n.value.trim())) this.issue(`HTML 块按纯文本导入：${n.value.slice(0, 60)}`)
    return this.paragraph([{ type: 'text', value: n.value }])
  }

  // Blocks written as HTML use the schema's own parse rules. Outside the browser the caller
  // provides a DOMParser (the import tool does); without one the block stays text.
  private htmlBlocks(html: string): JSONContent[] | null {
    if (typeof DOMParser === 'undefined') return null
    const body = new DOMParser().parseFromString(html, 'text/html').body
    const blocks = (SchemaParser.fromSchema(documentSchema().schema).parse(body).toJSON() as JSONContent).content ?? []
    return blocks.map((node) => mapTargets(
      node,
      (src) => (this.ctx.resolveImage ? this.ctx.resolveImage(src, 'html') : src),
      (href) => this.linkHref(href),
    ))
  }

  // inlineHtml converts the HTML we know how to keep (<img>, <br>); null means "not understood".
  private inlineHtml(value: string): JSONContent[] | null {
    const trimmed = value.trim()
    if (/^<br\s*\/?>$/i.test(trimmed)) return [{ type: 'hardBreak' }]
    const imgs = [...trimmed.matchAll(/<img\s[^>]*>/gi)]
    if (imgs.length && trimmed.replace(/<img\s[^>]*>/gi, '').trim() === '') {
      if (typeof DOMParser !== 'undefined') return this.htmlBlocks(`<p>${trimmed}</p>`)?.[0]?.content ?? []
      return imgs.flatMap((m): JSONContent[] => {
        const attr = (name: string) => new RegExp(`${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(m[0])?.[1] ?? null
        const src = attr('src')
        if (!src) return []
        const resolved = this.ctx.resolveImage ? this.ctx.resolveImage(src, 'html') : src
        if (!resolved) return [{ type: 'text', text: m[0] }]
        return [{ type: 'image', attrs: { src: resolved, alt: attr('alt'), title: attr('title'), width: numberOrNull(attr('width')), height: numberOrNull(attr('height')), ...(alignment(attr('data-align')) ? { blockAlign: alignment(attr('data-align')) } : {}), ...(attr('data-frame') === 'shadow' ? { shadow: true } : {}) } }]
      })
    }
    return null
  }

  inline(nodes: PhrasingContent[], marks: Mark[]): JSONContent[] {
    const out: JSONContent[] = []
    for (const n of nodes) out.push(...this.phrasing(n, marks))
    return mergeText(out)
  }

  private phrasing(n: PhrasingContent, marks: Mark[]): JSONContent[] {
    switch (n.type) {
      case 'text':
        return this.text(n.value, marks)
      case 'strong':
        return this.inline(n.children, withMark(marks, { type: 'bold' }))
      case 'emphasis':
        return this.inline(n.children, withMark(marks, { type: 'italic' }))
      case 'delete':
        return this.inline(n.children, withMark(marks, { type: 'strike' }))
      case 'inlineCode':
        return n.value ? [textNode(n.value, withMark(marks, { type: 'code' }))] : []
      case 'break':
        return [{ type: 'hardBreak' }]
      case 'inlineMath':
        // "$a$$b$" is two formulas in Obsidian, but one formula containing "$$" to remark-math.
        return n.value.split('$$').filter((s) => s.trim()).map((latex) => ({ type: 'inlineMath', attrs: { latex: cleanLatex(latex) } }))
      case 'link': {
        const href = this.linkHref(n.url)
        return this.inline(n.children, href ? withMark(marks, { type: 'link', attrs: { href } }) : marks)
      }
      case 'linkReference': {
        const def = this.defs.get(n.identifier.toLowerCase())
        if (!def) return this.text(`[${n.label ?? n.identifier}]`, marks)
        return this.inline(n.children, withMark(marks, { type: 'link', attrs: { href: this.linkHref(def.url) } }))
      }
      case 'image':
        return [this.image(n.url, n.alt ?? '', n.title ?? null, 'markdown')]
      case 'imageReference': {
        const def = this.defs.get(n.identifier.toLowerCase())
        return def ? [this.image(def.url, n.alt ?? '', def.title ?? null, 'markdown')] : this.text(`![${n.alt ?? ''}]`, marks)
      }
      case 'html': {
        const inline = this.inlineHtml(n.value)
        if (inline) return inline
        // Text such as List<String> or <cmd> is not HTML; keep it as written.
        if (!isHtmlTag(n.value)) return this.text(n.value, marks)
        if (!n.value.startsWith('<!--')) this.issue(`行内 HTML 标签已去掉，文字保留：${n.value.slice(0, 40)}`)
        return []
      }
      case 'footnoteReference':
        this.issue(`脚注引用 [^${n.identifier}] 按文字导入`)
        return this.text(`[^${n.identifier}]`, marks)
      default:
        this.issue(`不支持的行内内容 ${(n as { type: string }).type}，已跳过`)
        return []
    }
  }

  private linkHref(url: string): string | null {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) return url
    return this.ctx.resolveLink ? this.ctx.resolveLink(decodeURIComponent(url), 'markdown') : url
  }

  // Splits a size suffix out of alt text: "diagram|300" or "|300x200".
  private image(target: string, alt: string, title: string | null, kind: 'markdown' | 'wiki'): JSONContent {
    let width: number | null = null
    let height: number | null = null
    const m = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(alt)
    if (m) {
      alt = m[1]
      width = Number(m[2])
      height = m[3] ? Number(m[3]) : null
    }
    const decoded = kind === 'markdown' ? safeDecode(target) : target
    const src = this.ctx.resolveImage ? this.ctx.resolveImage(decoded, kind) : decoded
    if (!src) return { type: 'text', text: kind === 'wiki' ? `![[${target}]]` : `![${alt}](${target})` }
    return { type: 'image', attrs: { src, alt: alt || null, title, width, height } }
  }

  // Plain text: line breaks, ![[embeds]], [[links]] and ==highlight==.
  private text(value: string, marks: Mark[]): JSONContent[] {
    const out: JSONContent[] = []
    const lines = value.split('\n')
    lines.forEach((line, i) => {
      if (i > 0) out.push(this.ctx.breaks ? { type: 'hardBreak' } : textNode(' ', marks))
      out.push(...this.obsidianInline(line, marks))
    })
    return out
  }

  private obsidianInline(line: string, marks: Mark[]): JSONContent[] {
    const out: JSONContent[] = []
    const re = /(!?)\[\[([^\]\n]+?)\]\]|==([^=\n](?:[^\n]*?[^=\n])?)==/g
    let last = 0
    for (const m of line.matchAll(re)) {
      if (m.index! > last) out.push(textNode(line.slice(last, m.index), marks))
      if (m[2] !== undefined) {
        const [target, alias] = splitOnce(m[2], '|')
        if (m[1]) {
          out.push(this.image(target.trim(), alias ? `|${alias.trim()}` : '', null, 'wiki'))
        } else {
          const href = this.ctx.resolveLink ? this.ctx.resolveLink(target.trim(), 'wiki') : null
          const label = (alias ?? target).trim()
          out.push(textNode(label, href ? withMark(marks, { type: 'link', attrs: { href } }) : marks))
        }
      } else {
        out.push(textNode(m[3], withMark(marks, { type: 'highlight' })))
      }
      last = m.index! + m[0].length
    }
    if (last < line.length) out.push(textNode(line.slice(last), marks))
    return out.filter((n) => n.type !== 'text' || n.text)
  }
}

const htmlTagNames = new Set(
  ('a abbr address article aside audio b bdi bdo big blockquote br button caption center cite code col colgroup dd del ' +
    'details dfn div dl dt em figcaption figure font footer form h1 h2 h3 h4 h5 h6 header hr i iframe img input ins kbd ' +
    'label li main mark nav ol option p pre q rp rt ruby s samp script section select small source span strike strong ' +
    'style sub summary sup svg table tbody td textarea tfoot th thead time tr tt u ul var video wbr').split(' '),
)

// isHtmlTag tells real HTML (<u>, </font>, <!-- -->) from text in angle brackets (<String>, <cmd>).
function isHtmlTag(value: string): boolean {
  if (value.startsWith('<!--')) return true
  const m = /^<\/?([a-zA-Z][\w-]*)/.exec(value)
  return !!m && htmlTagNames.has(m[1].toLowerCase())
}

// "\*" is a Markdown escape left inside some formulas; LaTeX has no such command and "*" was meant.
function cleanLatex(latex: string): string {
  return latex.replace(/(^|[^\\])\\\*/g, '$1*')
}

function content(nodes: JSONContent[]): { content?: JSONContent[] } {
  return nodes.length ? { content: nodes } : {}
}

function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text }
}

// mergeText joins neighbouring text nodes with identical marks so documents stay compact.
function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (n.type === 'text' && prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      prev.text = (prev.text ?? '') + (n.text ?? '')
    } else if (n.type !== 'text' || n.text) {
      out.push(n)
    }
  }
  return out
}

function trimPhrasing(nodes: PhrasingContent[]): PhrasingContent[] {
  const out = nodes.map((n) => (n.type === 'text' ? { ...n } : n))
  const first = out[0]
  if (first?.type === 'text') first.value = first.value.replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last?.type === 'text') last.value = last.value.replace(/\s+$/, '')
  return out.filter((n) => n.type !== 'text' || n.value)
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep)
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)]
}

function numberOrNull(v: string | null): number | null {
  if (!v) return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const languageAliases: Record<string, string> = {
  'c++': 'cpp', cc: 'cpp', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', js: 'javascript',
  ts: 'typescript', py: 'python', golang: 'go', yml: 'yaml', text: '', txt: '', plain: '', plaintext: '', 代码段: '',
}

// Mirrors NormalizeLanguage in internal/render/highlight.go.
export function normalizeLanguage(lang: string): string {
  let l = lang.trim().toLowerCase().replace(/[,.;:，。；：]+$/, '')
  if (l in languageAliases) l = languageAliases[l]
  return l
}

// ---------------------------------------------------------------------------
// Export: Tiptap JSON -> Markdown readable by Obsidian.

export interface ExportContext {
  imageSrc?: (src: string) => string
  linkHref?: (href: string) => string
  // Table columns are padded to line up unless this is false; comparing versions turns it off so
  // that one longer cell does not change every row.
  alignTables?: boolean
}

export function docToMarkdown(doc: JSONContent, ctx: ExportContext = {}): string {
  const root: Root = { type: 'root', children: new Exporter(ctx).blocks(doc.content ?? []) as RootContent[] }
  return unified()
    .use(remarkGfm, { tablePipeAlign: ctx.alignTables ?? true })
    .use(remarkMath)
    .use(remarkStringify, { bullet: '-', fences: true, emphasis: '*', strong: '*', rule: '-', listItemIndent: 'one' })
    .stringify(root)
}

class Exporter {
  constructor(private ctx: ExportContext) {}

  blocks(nodes: JSONContent[]): Nodes[] {
    return nodes.flatMap((n) => this.block(n))
  }

  private block(n: JSONContent): Nodes[] {
    const kids = n.content ?? []
    switch (n.type) {
      case 'paragraph':
        if (alignment(n.attrs?.textAlign) || kids.some((c) => c.type === 'image' && alignment(c.attrs?.blockAlign))) return [{ type: 'html', value: this.nodeHtml(n) }]
        return [{ type: 'paragraph', children: this.inline(kids) }]
      case 'heading':
        return [{ type: 'heading', depth: (n.attrs?.level ?? 1) as 1, children: this.inline(kids) }]
      case 'horizontalRule':
        return [{ type: 'thematicBreak' }]
      case 'blockquote':
        return [{ type: 'blockquote', children: this.blocks(kids) as Blockquote['children'] }]
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return [{
          type: 'list',
          ordered: n.type === 'orderedList',
          start: n.type === 'orderedList' ? (n.attrs?.start ?? 1) : null,
          spread: false,
          children: kids.map((item) => ({
            type: 'listItem',
            spread: false,
            checked: n.type === 'taskList' ? !!item.attrs?.checked : null,
            children: this.blocks(item.content ?? []) as ListItem['children'],
          })),
        }]
      case 'codeBlock': {
        // A fence needs a language before the title; "text" reads back as no language.
        const meta = codeMeta(n.attrs?.title, n.attrs?.collapsed)
        return [{ type: 'code', lang: (n.attrs?.language as string) || (meta ? 'text' : null), meta, value: textOf(n) }]
      }
      case 'blockMath':
        return [{ type: 'math', value: String(n.attrs?.latex ?? '') }]
      case 'table':
        return tableNeedsHtml(n) ? [{ type: 'html', value: this.nodeHtml(n) }] : [this.table(n)]
      case 'callout': {
        const [title, body] = kids
        const fold = String(n.attrs?.fold ?? '')
        const marker: Html = { type: 'html', value: `[!${n.attrs?.type ?? 'note'}]${fold}${title?.content?.length ? ' ' : ''}` }
        return [{
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: [marker, ...this.inline(title?.content ?? [])] },
            ...(this.blocks(body?.content ?? []) as Blockquote['children']),
          ],
        }]
      }
      default:
        return [{ type: 'paragraph', children: this.inline(kids) }]
    }
  }

  // Written with the schema's rendering, rows on lines of their own; a blank line, which would end
  // the HTML block in Markdown, is written as &#10;.
  private nodeHtml(n: JSONContent): string {
    const node = mapTargets(n, (src) => this.ctx.imageSrc?.(src) ?? src, (href) => this.ctx.linkHref?.(href) ?? href)
    return renderToHTMLString({ extensions: documentSchema().extensions, content: { type: 'doc', content: [node] } })
      .replace('<tbody>', '<tbody>\n')
      .replace(/<\/tr>/g, '</tr>\n')
      .replace(/\n(?=\n)/g, '&#10;')
  }

  private table(n: JSONContent): Table {
    const rows = n.content ?? []
    const align = (rows[0]?.content ?? []).map((c) => (c.attrs?.align ?? null) as Table['align'] extends (infer A)[] | null | undefined ? A : never)
    return {
      type: 'table',
      align,
      children: rows.map((row) => ({
        type: 'tableRow',
        children: (row.content ?? []).map((cell) => ({
          type: 'tableCell',
          children: (cell.content ?? []).flatMap((p, i) => [
            ...(i > 0 ? [{ type: 'html', value: '<br>' } as Html] : []),
            ...this.inline(p.content ?? []),
          ]) as PhrasingContent[],
        })),
      })),
    }
  }

  // inline turns text nodes with marks into nested mdast phrasing content.
  inline(nodes: JSONContent[]): PhrasingContent[] {
    const out: PhrasingContent[] = []
    for (const n of nodes) {
      switch (n.type) {
        case 'text':
          out.push(...this.marked(n))
          break
        case 'hardBreak':
          out.push({ type: 'break' })
          break
        case 'inlineMath':
          out.push({ type: 'inlineMath', value: String(n.attrs?.latex ?? '') })
          break
        case 'image':
          out.push(this.image(n))
          break
      }
    }
    return out
  }

  private marked(n: JSONContent): PhrasingContent[] {
    const marks = n.marks ?? []
    let nodes: PhrasingContent[] = marks.some((m) => m.type === 'code')
      ? [{ type: 'inlineCode', value: n.text ?? '' }]
      : [{ type: 'text', value: n.text ?? '' }]
    for (const m of [...marks].reverse()) {
      switch (m.type) {
        case 'bold':
          nodes = [{ type: 'strong', children: nodes }]
          break
        case 'italic':
          nodes = [{ type: 'emphasis', children: nodes }]
          break
        case 'strike':
          nodes = [{ type: 'delete', children: nodes }]
          break
        case 'highlight':
          nodes = [{ type: 'html', value: '==' }, ...nodes, { type: 'html', value: '==' }]
          break
        case 'underline':
          nodes = [{ type: 'html', value: '<u>' }, ...nodes, { type: 'html', value: '</u>' }]
          break
        case 'link': {
          const href = String(m.attrs?.href ?? '')
          nodes = [{ type: 'link', url: this.ctx.linkHref ? this.ctx.linkHref(href) : href, children: nodes }]
          break
        }
      }
    }
    return nodes
  }

  private image(n: JSONContent): PhrasingContent {
    const a = n.attrs ?? {}
    const src = this.ctx.imageSrc ? this.ctx.imageSrc(String(a.src ?? '')) : String(a.src ?? '')
    if ((a.height && !a.width) || a.shadow === true || a.blockAlign) {
      return { type: 'html', value: this.nodeHtml(n) }
    }
    const size = a.width ? `|${a.width}${a.height ? `x${a.height}` : ''}` : ''
    return { type: 'image', url: src, alt: `${a.alt ?? ''}${size}`, title: a.title ?? null }
  }
}

function textOf(n: JSONContent): string {
  if (n.type === 'text') return n.text ?? ''
  return (n.content ?? []).map(textOf).join('')
}

// Tables Markdown cannot hold, which docToMarkdown writes as HTML: column widths, row heights,
// merged cells, or cells holding more than paragraphs. Anything else Markdown cannot express that
// the editor gains later is exported as HTML too, so nothing is lost.
function tableNeedsHtml(n: JSONContent): boolean {
  if (alignment(n.attrs?.blockAlign)) return true
  return (n.content ?? []).some(
    (row) =>
      !!row.attrs?.height ||
      (row.content ?? []).some((cell) => {
        const a = cell.attrs ?? {}
        return !!alignment(a.cellAlign) || (a.colspan ?? 1) > 1 || (a.rowspan ?? 1) > 1 || !!(a.colwidth as number[] | null)?.some(Boolean) || (cell.content ?? []).some((b) => b.type !== 'paragraph' || !!alignment(b.attrs?.textAlign) || b.content?.some((c) => !!alignment(c.attrs?.blockAlign)))
      }),
  )
}

// The document schema, for tables written as HTML: they are rendered and read back through the
// schema itself.
let schemaParts: { extensions: Extensions; schema: Schema } | null = null
function documentSchema() {
  if (!schemaParts) {
    const extensions = schemaExtensions()
    schemaParts = { extensions, schema: getSchema(extensions) }
  }
  return schemaParts
}

// Rewrites the image sources and link targets inside a node, as the rest of the Markdown gets them.
function mapTargets(n: JSONContent, image: (src: string) => string | null, link: (href: string) => string | null): JSONContent {
  const out: JSONContent = { ...n }
  if (n.type === 'image' && typeof n.attrs?.src === 'string') out.attrs = { ...n.attrs, src: image(n.attrs.src) ?? n.attrs.src }
  if (n.marks) {
    out.marks = n.marks.map((m) => (m.type === 'link' && typeof m.attrs?.href === 'string' ? { ...m, attrs: { ...m.attrs, href: link(m.attrs.href) ?? m.attrs.href } } : m))
  }
  if (n.content) out.content = n.content.map((c) => mapTargets(c, image, link))
  return out
}
