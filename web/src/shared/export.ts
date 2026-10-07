import type { JSONContent } from '@tiptap/core'
import { drawingSource } from '../schema/drawing'
import { attachmentSource } from '../schema/attachment'
import { docToMarkdown } from '../schema/markdown'

// Lays out knowledge bases as an Obsidian-readable folder tree: every knowledge base is a folder,
// groups are folders, documents are Markdown files, and a document with children is a Markdown
// file plus a folder of the same name (Obsidian's folder-note layout). Images go to one shared
// attachments folder and are linked with relative paths. Used by the export tool and the web export.

export interface ExportTreeNode {
  id: number
  kind: string
  title: string
  children?: ExportTreeNode[]
}

export interface ExportBook {
  id: number
  name: string
  tree: ExportTreeNode[]
}

export interface ExportEntry {
  id: number
  kind: 'doc' | 'group'
  title: string
  book: string
  // Relative to the export root, with "/" separators: the Markdown file of a document and the
  // folder of a group or of a document with children.
  file?: string
  dir?: string
}

export interface ExportPlan {
  entries: Map<number, ExportEntry>
  // Every folder to create, parents before children.
  dirs: string[]
  // Titles that could not be used unchanged as file names.
  renamed: { book: string; title: string; name: string }[]
}

export const attachmentsDir = 'attachments'
export const metaDir = '.yuyan-export'

const invalidChars = /[\\/:*?"<>|\u0000-\u001f\u007f]/g
const maxNameBytes = 200

// fileName turns a title into a name that is valid on macOS, Windows and Linux.
export function fileName(title: string): string {
  const chars = Array.from(title.replace(invalidChars, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '_').replace(/[. ]+$/, ''))
  const encoder = new TextEncoder()
  while (chars.length && encoder.encode(chars.join('')).length > maxNameBytes) chars.pop()
  return chars.join('') || '未命名'
}

// Names hands out sibling names that do not collide on case-insensitive file systems. A document
// needs "<name>.md", a folder needs "<name>", and a document with children needs both.
class Names {
  private used = new Set<string>()

  constructor(reserved: string[] = []) {
    for (const r of reserved) this.used.add(r.toLowerCase())
  }

  claim(base: string, want: { file: boolean; dir: boolean }): string {
    for (let i = 1; ; i++) {
      const name = i === 1 ? base : `${base} (${i})`
      const keys = [...(want.dir ? [name] : []), ...(want.file ? [`${name}.md`] : [])].map((k) => k.toLowerCase())
      if (keys.every((k) => !this.used.has(k))) {
        for (const k of keys) this.used.add(k)
        return name
      }
    }
  }
}

const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name)

function placeNodes(plan: ExportPlan, nodes: ExportTreeNode[], parent: string, book: string, names = new Names()) {
  for (const n of nodes) {
    const kind = n.kind === 'group' ? 'group' : 'doc'
    const hasChildren = !!n.children?.length
    const name = names.claim(fileName(n.title), { file: kind === 'doc', dir: kind === 'group' || hasChildren })
    if (name !== n.title) plan.renamed.push({ book, title: n.title, name })
    const entry: ExportEntry = { id: n.id, kind, title: n.title, book }
    if (kind === 'doc') entry.file = `${join(parent, name)}.md`
    if (kind === 'group' || hasChildren) {
      entry.dir = join(parent, name)
      plan.dirs.push(entry.dir)
    }
    plan.entries.set(n.id, entry)
    if (hasChildren) placeNodes(plan, n.children!, entry.dir!, book)
  }
}

// planExport puts each knowledge base in a folder of its own at the export root.
export function planExport(books: ExportBook[]): ExportPlan {
  const plan: ExportPlan = { entries: new Map(), dirs: [], renamed: [] }
  const roots = new Names([attachmentsDir, metaDir])
  for (const book of books) {
    const bookDir = roots.claim(fileName(book.name), { file: false, dir: true })
    if (bookDir !== book.name) plan.renamed.push({ book: book.name, title: book.name, name: bookDir })
    plan.dirs.push(bookDir)
    placeNodes(plan, book.tree, bookDir, book.name)
  }
  return plan
}

// planNodes lays out part of one knowledge base, such as a document and its children, at the root.
export function planNodes(book: string, nodes: ExportTreeNode[]): ExportPlan {
  const plan: ExportPlan = { entries: new Map(), dirs: [], renamed: [] }
  placeNodes(plan, nodes, '', book, new Names([attachmentsDir, metaDir]))
  return plan
}

// relativePath returns the path of target as seen from the folder containing fromFile.
export function relativePath(fromFile: string, target: string): string {
  const from = fromFile.split('/').slice(0, -1)
  const to = target.split('/')
  let i = 0
  while (i < from.length && i < to.length && from[i] === to[i]) i++
  return [...Array<string>(from.length - i).fill('..'), ...to.slice(i)].join('/') || '.'
}

// encodeLinkPath percent-encodes what would break a Markdown link destination, keeping CJK text
// readable the way Obsidian writes its own Markdown links.
export function encodeLinkPath(path: string): string {
  return path.replace(/[\s%()<>[\]#?^|]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)))
}

const assetSrc = /^\/assets\/([0-9a-f]{32}\.[a-z0-9]+)$/
const docHref = /^\/docs\/(\d+)(#.*)?$/

export interface ExportedDoc {
  markdown: string
  // Image files (for example "<id>.png") the document refers to.
  assets: string[]
  assetURLs: Record<string, string>
  // Links to documents that are not part of the plan, such as documents in the trash.
  missingLinks: string[]
}

// unresolvedLink decides what a link to a document outside the plan becomes; by default it stays
// as written and is reported in missingLinks.
export function exportDoc(content: JSONContent, file: string, plan: ExportPlan, unresolvedLink?: (href: string) => string): ExportedDoc {
  const assets = new Set<string>()
  const assetURLs: Record<string, string> = {}
  const missingLinks: string[] = []
  const markdown = docToMarkdown(content, {
    drawingSrc: src => {
      const m = drawingSource.exec(src)
      if (!m) throw new Error('无效的画板地址')
      const filename = m[1] + '.yuyan.json'
      assets.add(filename)
      assetURLs[filename] = src + '/file'
      // Both preview formats are represented by the node's immutable metadata.
      const find = (n: JSONContent): string | undefined => n.type === 'drawing' && n.attrs?.src === src ? String(n.attrs.previewMime) : n.content?.map(find).find(Boolean)
      const preview = m[1] + (find(content) === 'image/png' ? '.png' : '.svg')
      assets.add(preview)
      assetURLs[preview] = src + '/preview'
      return encodeLinkPath(relativePath(file, attachmentsDir + '/' + filename))
    },
    imageSrc: (src) => {
      const m = assetSrc.exec(src)
      if (!m) return src
      assets.add(m[1])
      assetURLs[m[1]] = `/assets/${m[1]}`
      return encodeLinkPath(relativePath(file, `${attachmentsDir}/${m[1]}`))
    },
    attachmentSrc: (src, name) => {
      const m = attachmentSource.exec(src)
      if (!m) throw new Error('无效的附件地址：' + name)
      const filename = m[1] + '-' + fileName(name)
      assets.add(filename)
      assetURLs[filename] = src
      return encodeLinkPath(relativePath(file, attachmentsDir + '/' + filename))
    },
    linkHref: (href) => {
      const m = docHref.exec(href)
      if (!m) return href
      const target = plan.entries.get(Number(m[1]))
      const path = target?.file ?? target?.dir
      if (!path) {
        missingLinks.push(href)
        return unresolvedLink ? unresolvedLink(href) : href
      }
      return encodeLinkPath(relativePath(file, path)) + (m[2] ?? '')
    },
  })
  return { markdown, assets: [...assets], assetURLs, missingLinks }
}
