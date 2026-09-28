// Repair imported strong marks using the original Markdown, never by interpreting stored text.
// Source files are named <document id>.md and must come from the original import revision.
// Preview is GET-only; applying the reviewed report snapshots each document and checks revision.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { diffArrays } from 'diff'
import { schemaExtensions } from '../../src/schema/extensions'
import { markdownToDoc } from '../../src/schema/markdown'

const schema = getSchema(schemaExtensions())
const textblocks = new Set(['paragraph', 'heading', 'calloutTitle'])
interface Patch { path: number[]; before: JSONContent; after: JSONContent }
interface Doc { id: number; title: string; revision: number; content: JSONContent }
interface Entry { id: number; title: string; revision: number; hash: string; patches: Patch[]; skipped: number }
interface Report { format: 1; created: string; documents: Entry[] }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const hash = (content: JSONContent) => createHash('sha256').update(canonical(content)).digest('hex')
const bold = (n: JSONContent) => n.marks?.some((m) => m.type === 'bold') ?? false
const units = (n: JSONContent): JSONContent[] => (n.content ?? []).flatMap((c) => c.type === 'text'
  ? Array.from(c.text ?? '', (text) => ({ ...c, text })) : [c])

function key(n: JSONContent, withBold = true): string {
  // Normalise schema defaults and mark order. Import resolves these targets; preserve the
  // current targets when patching rather than copying unresolved paths from the Markdown.
  const normalized = Node.fromJSON(schema, n).toJSON() as JSONContent
  if (normalized.type === 'image' && normalized.attrs) delete normalized.attrs.src
  normalized.marks = (normalized.marks ?? []).filter((m) => withBold || m.type !== 'bold')
    .map((m) => m.type === 'link' ? { type: 'link' } : m).sort((a, b) => a.type.localeCompare(b.type))
  return canonical(normalized)
}

function blocks(doc: JSONContent): { node: JSONContent; path: number[] }[] {
  const result: { node: JSONContent; path: number[] }[] = []
  function walk(node: JSONContent, path: number[]) {
    if (textblocks.has(node.type ?? '')) result.push({ node, path })
    else if (node.type !== 'codeBlock') node.content?.forEach((c, i) => walk(c, [...path, i]))
  }
  walk(doc, [])
  return result
}

function merge(items: JSONContent[]): JSONContent[] {
  const result: JSONContent[] = []
  for (const item of items) {
    const prev = result.at(-1)
    if (prev?.type === 'text' && item.type === 'text' && canonical(prev.marks) === canonical(item.marks)) prev.text! += item.text
    else result.push({ ...item })
  }
  return result
}

export function repairImportedStrong(current: JSONContent, markdown: string) {
  const oldBlocks = blocks(markdownToDoc(markdown, { breaks: true, strictStrong: true }))
  const newBlocks = blocks(markdownToDoc(markdown, { breaks: true }))
  if (oldBlocks.length !== newBlocks.length) throw new Error('解析前后块结构不同，需人工核对')
  type Candidate = { before: JSONContent[]; after: JSONContent[]; keep: number[] }
  const candidates = new Map<string, Candidate | null>()
  const signature = (n: JSONContent) => canonical([n.type, units(n).map((u) => key(u))])
  const interpretations = new Map<string, Set<string>>()
  oldBlocks.forEach(({ node }, i) => {
    const id = signature(node), variants = interpretations.get(id) ?? new Set<string>()
    variants.add(signature(newBlocks[i].node))
    interpretations.set(id, variants)
  })
  let skipped = 0
  for (let i = 0; i < oldBlocks.length; i++) {
    const before = oldBlocks[i].node, after = newBlocks[i].node
    if (canonical(before) === canonical(after)) continue
    // Escaped literal stars and failed strong can have identical stored JSON. If
    // both occur in the source, their positions alone are not enough to repair safely.
    if (interpretations.get(signature(before))!.size > 1) { skipped++; continue }
    const a = units(before), b = units(after), keep: number[] = []
    let offset = 0, valid = before.type === after.type
    for (const change of diffArrays(a.map((u) => key(u, false)), b.map((u) => key(u, false)))) {
      if (change.added) valid = false
      else if (change.removed) {
        const removed = a.slice(offset, offset + change.count!)
        if (removed.length % 2 || removed.some((u) => u.type !== 'text' || u.text !== '*' || u.marks?.some((m) => m.type === 'code'))) valid = false
        offset += change.count!
      } else {
        for (let j = 0; j < change.count!; j++) keep.push(offset++)
      }
    }
    // Only remove paired stars and alter bold. Any other semantic change needs manual review.
    if (!valid || keep.length !== b.length) { skipped++; continue }
    const id = signature(before), prior = candidates.get(id)
    const candidate = { before: a, after: b, keep }
    candidates.set(id, prior === null || (prior && canonical(prior) !== canonical(candidate)) ? null : candidate)
  }
  const patches: Patch[] = [], matched = new Set<string>()
  for (const { node, path } of blocks(current)) {
    const id = signature(node), candidate = candidates.get(id)
    if (!candidate) continue
    matched.add(id)
    const original = units(node)
    const content = merge(candidate.keep.map((oldIndex, newIndex) => {
      const unit = original[oldIndex], desired = bold(candidate.after[newIndex])
      if (bold(unit) === desired) return unit
      const marks = (unit.marks ?? []).filter((m) => m.type !== 'bold')
      if (desired) marks.push({ type: 'bold' })
      const { marks: _, ...rest } = unit
      return marks.length ? { ...rest, marks } : rest
    }))
    const after = { ...node, content }
    if (canonical(node) !== canonical(after)) patches.push({ path, before: node, after })
  }
  skipped += [...candidates.keys()].filter((id) => !matched.has(id)).length
  const content = applyPatches(current, patches)
  Node.fromJSON(schema, content).check()
  return { content, patches, skipped }
}

export function applyPatches(doc: JSONContent, patches: Patch[]): JSONContent {
  const result = structuredClone(doc)
  for (const patch of patches) {
    if (!patch.path.length) throw new Error('不能替换整篇文档')
    let parent = result
    for (const index of patch.path.slice(0, -1)) parent = parent.content![index]
    const index = patch.path.at(-1)!
    if (canonical(parent.content?.[index]) !== canonical(patch.before)) throw new Error('段落已变化，未写入')
    parent.content![index] = structuredClone(patch.after)
  }
  Node.fromJSON(schema, result).check()
  return result
}

async function main() {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
  const server = arg('--server'), source = arg('--source-dir'), preview = arg('--preview'), apply = arg('--apply')
  if (!server || (apply ? source || preview : !source || !preview)) throw new Error('usage: --server <url> --source-dir <id.md directory> --preview <report.json> | --server <url> --apply <reviewed report.json>')
  const base = server.endsWith('/') ? server : `${server}/`
  async function api(path: string, method = 'GET', body?: unknown) {
    const res = await fetch(new URL(`api/${path}`, base), { method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`)
    return res
  }
  if (apply) {
    const report = JSON.parse(readFileSync(apply, 'utf8')) as Report
    if (report.format !== 1 || !Array.isArray(report.documents)) throw new Error('未知报告格式')
    // Preflight every document before writing any. PUT also guards edits during the write phase.
    const pending: { entry: Entry; content: JSONContent }[] = []
    for (const entry of report.documents.filter((e) => e.patches.length)) {
      const doc = await (await api(`docs/${entry.id}`)).json() as Doc
      if (doc.revision !== entry.revision || hash(doc.content) !== entry.hash || doc.title !== entry.title) throw new Error(`#${entry.id} 在预览后被修改，请重新生成预览`)
      pending.push({ entry, content: applyPatches(doc.content, entry.patches) })
    }
    for (const { entry, content } of pending) {
      await api(`docs/${entry.id}/snapshot`, 'POST')
      await api(`docs/${entry.id}`, 'PUT', { title: entry.title, content, baseRevision: entry.revision })
      console.log(`#${entry.id}：已修复 ${entry.patches.length} 段，原内容保留在历史记录中`)
    }
    return
  }
  const report: Report = { format: 1, created: new Date().toISOString(), documents: [] }
  for (const file of readdirSync(source!).filter((f) => /^\d+\.md$/.test(f))) {
    const id = Number(file.slice(0, -3)), doc = await (await api(`docs/${id}`)).json() as Doc
    const { patches, skipped } = repairImportedStrong(doc.content, readFileSync(join(source!, file), 'utf8'))
    report.documents.push({ id, title: doc.title, revision: doc.revision, hash: hash(doc.content), patches, skipped })
    console.log(`#${id}：拟修复 ${patches.length} 段，待核对 ${skipped} 段`)
  }
  writeFileSync(preview!, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  console.log(`预览完成：${report.documents.filter((d) => d.patches.length).length} 篇、${report.documents.reduce((n, d) => n + d.patches.length, 0)} 段；未写入服务器`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exitCode = 1 })
