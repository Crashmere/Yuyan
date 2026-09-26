// Checks that every stored document passes through the editor schema without losing or changing
// content, and that editing a table would not reshape it (see src/editor/tables.ts):
//   npm --prefix web run roundtrip -- --server http://127.0.0.1:18084/yuyan/
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { tablesToReshape } from '../../src/editor/tables'
import { schemaExtensions } from '../../src/schema/extensions'

interface TreeNode {
  id: number
  kind: string
  title: string
  children?: TreeNode[]
}

interface AttrSpec {
  hasDefault: boolean
  default: unknown
}

const schema = getSchema(schemaExtensions())

function serverArg(): string {
  const i = process.argv.indexOf('--server')
  const url = i >= 0 ? process.argv[i + 1] : undefined
  if (!url) throw new Error('usage: roundtrip --server <http://host/yuyan/>')
  return url.endsWith('/') ? url : `${url}/`
}

async function get<T>(base: string, path: string): Promise<T> {
  const res = await fetch(new URL(`api/${path}`, base))
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

function attrSpecs(type: unknown): Record<string, AttrSpec> {
  return (type as { attrs?: Record<string, AttrSpec> } | undefined)?.attrs ?? {}
}

// Attributes equal to their schema default carry no information.
function cleanAttrs(attrs: Record<string, unknown> | undefined, specs: Record<string, AttrSpec>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs ?? {})) {
    const spec = specs[k]
    if (v === undefined || (spec?.hasDefault && JSON.stringify(spec.default) === JSON.stringify(v))) continue
    out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

// Mark order and the split of adjacent text runs with identical marks do not change the document.
function normalize(n: JSONContent): JSONContent {
  const out: JSONContent = { type: n.type }
  const attrs = cleanAttrs(n.attrs, attrSpecs(schema.nodes[n.type ?? '']))
  if (attrs) out.attrs = attrs
  if (n.text !== undefined) out.text = n.text
  if (n.marks?.length) {
    out.marks = n.marks
      .map((m) => {
        const a = cleanAttrs(m.attrs, attrSpecs(schema.marks[m.type]))
        return a ? { type: m.type, attrs: a } : { type: m.type }
      })
      .sort((a, b) => a.type.localeCompare(b.type))
  }
  if (n.content?.length) {
    const merged: JSONContent[] = []
    for (const child of n.content.map(normalize)) {
      const prev = merged[merged.length - 1]
      if (prev?.type === 'text' && child.type === 'text' && JSON.stringify(prev.marks) === JSON.stringify(child.marks)) {
        prev.text = (prev.text ?? '') + (child.text ?? '')
      } else {
        merged.push(child)
      }
    }
    out.content = merged
  }
  return out
}

// Key order inside an object is not part of the document.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'undefined'
}

function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (canonical(a) === canonical(b)) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
      if (d) return d
    }
  }
  return `${path || '(root)'}: ${JSON.stringify(a)?.slice(0, 120)} → ${JSON.stringify(b)?.slice(0, 120)}`
}

function countTables(node: Node): number {
  let n = 0
  node.descendants((child) => {
    if (child.type.name === 'table') n++
    return child.type.name !== 'table'
  })
  return n
}

function docIds(nodes: TreeNode[], out: { id: number; title: string }[] = []) {
  for (const n of nodes) {
    if (n.kind === 'doc') out.push({ id: n.id, title: n.title })
    docIds(n.children ?? [], out)
  }
  return out
}

async function main() {
  const base = serverArg()
  const books = await get<{ id: number; name: string }[]>(base, 'books')
  let checked = 0
  let trailing = 0
  let tables = 0
  const failures: string[] = []
  for (const book of books) {
    for (const d of docIds(await get<TreeNode[]>(base, `books/${book.id}/tree`))) {
      const { content } = await get<{ content: JSONContent }>(base, `docs/${d.id}`)
      checked++
      try {
        const node = Node.fromJSON(schema, content)
        node.check()
        const diff = firstDifference(normalize(content), normalize(node.toJSON() as JSONContent))
        if (diff) failures.push(`${book.name} / ${d.title}（#${d.id}）：${diff}`)
        const reshaped = tablesToReshape(node)
        if (reshaped) failures.push(`${book.name} / ${d.title}（#${d.id}）：${reshaped} 个表格在编辑时会被调整表头或列对齐`)
        tables += countTables(node)
        if (node.lastChild?.type.name !== 'paragraph') trailing++
      } catch (e) {
        failures.push(`${book.name} / ${d.title}（#${d.id}）：${(e as Error).message}`)
      }
    }
  }
  console.log(`检查 ${checked} 篇文档（含 ${tables} 个表格）：${checked - failures.length} 篇通过，${failures.length} 篇有差异`)
  console.log(`${trailing} 篇不以段落结尾，编辑器首次保存时会在末尾补一个空段落`)
  for (const f of failures) console.log(`- ${f}`)
  if (failures.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
