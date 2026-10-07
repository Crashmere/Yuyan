import { createHash } from 'node:crypto'
import { importDrawingPackage } from '../../src/drawing/portable'
import type { DrawingPackage } from '../../src/drawing/types'
// Imports the Obsidian notes into a Yuyan instance once, then writes a report of everything that
// needs a human decision. Run against a local instance first:
//   npm --prefix web run import -- --source <repo> --server http://127.0.0.1:18084/yuyan/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import katex from 'katex'
import { Window } from 'happy-dom'
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc } from '../../src/schema/markdown'
import { needsDisplay } from '../../src/shared/latex'

// markdownToDoc reads tables written as HTML with a DOMParser, which Node lacks.
globalThis.DOMParser = new Window().DOMParser as unknown as typeof DOMParser
import { FileIndex, imageExtensions, resolveFile } from './resolve'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

interface Args {
  source: string
  server: string
  report: string
  overrides: Record<string, string>
  dry: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const source = get('source')
  if (!source) throw new Error('usage: import --source <obsidian repo> --server <http://host/yuyan/> [--report file] [--overrides file] [--dry]')
  const overridesFile = get('overrides')
  return {
    source,
    server: (get('server') ?? 'http://127.0.0.1:18084/yuyan/').replace(/\/?$/, '/'),
    report: get('report') ?? join(repoRoot, '.local/import-report.md'),
    overrides: overridesFile ? JSON.parse(readFileSync(overridesFile, 'utf8')).images ?? {} : {},
    dry: argv.includes('--dry'),
  }
}

// ---------------------------------------------------------------------------------------------

class Client {
  constructor(private base: string, private dry: boolean) {}
  private fakeId = 0

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.dry) return { id: ++this.fakeId, url: `/assets/dry${this.fakeId}.png`, stats: { books: 0 } } as T
    const res = await fetch(this.base + 'api/' + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Yuyan-Features': 'drawing-v1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.message ?? ''}`)
    return data as T
  }

  async upload(data: Buffer, name: string, attachment = false): Promise<{ url: string }> {
    if (this.dry) return { url: attachment ? '/attachments/' + (++this.fakeId).toString(16).padStart(32, '0') : `/assets/dry${++this.fakeId}.png` }
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(data)]), name)
    const res = await fetch(this.base + (attachment ? 'api/attachments' : 'api/assets'), { method: 'POST', body: form })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${out.message ?? ''}`)
    return out
  }
}

// ---------------------------------------------------------------------------------------------

interface DocPlan {
  path: string
  title: string
  kb: string
  parentKey: string | null
}

interface GroupPlan {
  key: string
  title: string
  kb: string
  parentKey: string | null
}

// Top-level folders become knowledge bases; the children of 备份 are promoted to the top level.
function kbOf(path: string): string {
  const parts = path.split('/')
  if (parts[0] === '备份' && parts.length >= 3) return parts.slice(0, 2).join('/')
  return parts.length >= 2 ? parts[0] : '(根目录)'
}

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true })

function plan(idx: FileIndex) {
  const notes = idx.files.filter((f) => f.endsWith('.md') && !/^attachments\/[a-f0-9]{32}-/.test(f))
  const kbs = new Map<string, { groups: GroupPlan[]; docs: DocPlan[] }>()
  for (const path of notes) {
    const kb = kbOf(path)
    if (!kbs.has(kb)) kbs.set(kb, { groups: [], docs: [] })
    const entry = kbs.get(kb)!
    const inner = kb === '(根目录)' ? path : path.slice(kb.length + 1)
    const segments = inner.split('/')
    let parentKey: string | null = null
    for (let i = 0; i < segments.length - 1; i++) {
      const key = `${kb}/${segments.slice(0, i + 1).join('/')}`
      if (!entry.groups.some((g) => g.key === key)) entry.groups.push({ key, title: segments[i], kb, parentKey })
      parentKey = key
    }
    entry.docs.push({ path, title: segments[segments.length - 1].replace(/\.md$/i, ''), kb, parentKey })
  }
  return kbs
}

// Obsidian lists folders before files, each sorted by name with numbers in natural order.
function orderedChildren(entry: { groups: GroupPlan[]; docs: DocPlan[] }, parentKey: string | null) {
  const groups = entry.groups.filter((g) => g.parentKey === parentKey).sort((a, b) => collator.compare(a.title, b.title))
  const docs = entry.docs.filter((d) => d.parentKey === parentKey).sort((a, b) => collator.compare(a.title, b.title))
  return { groups, docs }
}

// ---------------------------------------------------------------------------------------------

interface Report {
  books: { name: string; docs: number }[]
  groups: number
  docs: number
  drawings: number
  images: number
  imageBytes: number
  attachments: number
  attachmentBytes: number
  ambiguous: string[]
  missingImages: string[]
  externalImages: string[]
  missingLinks: string[]
  issues: Map<string, string[]>
  math: string[]
  languages: Map<string, number>
  callouts: Map<string, number>
  largest: { path: string; kb: number }[]
}

// A link such as "www.rpmfind.net" that matches no note is a web address written without a scheme.
function looksLikeHost(target: string): boolean {
  return /^www\.[^\s/]+\.[a-z]{2,}(?:[/?#]|$)/i.test(target) || /^(?:[a-z0-9-]+\.)+(?:com|net|org|cn|io|dev|edu|gov|me)(?:[/?#]|$)/i.test(target)
}

function walk(node: JSONContent, fn: (n: JSONContent) => void) {
  fn(node)
  for (const c of node.content ?? []) walk(c, fn)
}

async function main() {
  const args = parseArgs()
  const started = Date.now()
  const idx = new FileIndex(args.source)
  const client = new Client(args.server, args.dry)
  if (!args.dry) {
    const meta = await client.json<{ stats: { books: number } }>('GET', 'meta')
    if (meta.stats.books > 0) throw new Error('目标实例已有知识库。导入只做一次，请对空实例运行。')
  }

  const kbs = plan(idx)
  const report: Report = {
    books: [], groups: 0, docs: 0, drawings: 0, images: 0, imageBytes: 0, attachments: 0, attachmentBytes: 0, ambiguous: [], missingImages: [], externalImages: [],
    missingLinks: [], issues: new Map(), math: [], languages: new Map(), callouts: new Map(), largest: [],
  }
  const docIds = new Map<string, number>()
  const docScope = new Map<string, string>()

  // Pass 1: create knowledge bases, groups and empty documents so links can point at real ids.
  const kbNames = [...kbs.keys()].sort((a, b) => collator.compare(a.split('/').pop()!, b.split('/').pop()!))
  for (const kb of kbNames) {
    const entry = kbs.get(kb)!
    const name = kb.split('/').pop()!
    const book = await client.json<{ id: number }>('POST', 'books', { name })
    report.books.push({ name, docs: entry.docs.length })
    const create = async (parentKey: string | null, parentId: number | null) => {
      const { groups, docs } = orderedChildren(entry, parentKey)
      for (const g of groups) {
        const created = await client.json<{ id: number }>('POST', 'docs', { bookId: book.id, parentId, kind: 'group', title: g.title })
        report.groups++
        await create(g.key, created.id)
      }
      for (const d of docs) {
        const created = await client.json<{ id: number }>('POST', 'docs', { bookId: book.id, parentId, kind: 'doc', title: d.title, sourcePath: d.path })
        docIds.set(d.path, created.id)
        docScope.set(d.path, idx.vaultOf(d.path)?.root ?? kb)
        report.docs++
      }
    }
    await create(null, null)
  }

  // Pass 2: convert each note, uploading the images it uses.
  const uploaded = new Map<string, string>()
  const uploadedAttachments = new Map<string, { url: string; size: number; mime?: string }>()
  for (const [path, id] of docIds) {
    const markdown = readFileSync(join(args.source, path), 'utf8')
    const scope = docScope.get(path)!
    const breaks = idx.vaultOf(path)?.breaks ?? true
    report.largest.push({ path, kb: Math.round(Buffer.byteLength(markdown) / 1024) })

    const drawingTargets = new Set<string>()
    const drawingAttrs = new Map<string, Record<string, unknown>>()
    const attachmentTargets = new Set<string>()
    const attachmentAttrs = new Map<string, Record<string, unknown> | null>()
    const wanted: { target: string; kind: string }[] = []
    markdownToDoc(markdown, { breaks, resolveDrawing: target => { drawingTargets.add(target); return { src: target } }, resolveAttachment: target => { attachmentTargets.add(target); return { src: target } }, resolveImage: (target, kind) => (wanted.push({ target, kind }), target) })
    const images = new Map<string, string | null>()
    for (const { target, kind } of wanted) {
      const key = `${kind}|${target}`
      if (images.has(key)) continue
      const override = args.overrides[`${path}|${target}`] ?? args.overrides[target]
      const r = resolveFile(idx, target, path, scope, imageExtensions, override)
      if (r.kind === 'found') {
        let url = uploaded.get(r.path)
        if (!url) {
          const data = readFileSync(join(args.source, r.path))
          url = (await client.upload(data, posix.basename(r.path))).url
          uploaded.set(r.path, url)
          report.images++
          report.imageBytes += data.length
        }
        images.set(key, url)
      } else if (r.kind === 'external') {
        report.externalImages.push(`${path}：${target}`)
        images.set(key, target)
      } else if (r.kind === 'ambiguous') {
        report.ambiguous.push(`${path}：${target} → ${r.candidates.join('、')}`)
        images.set(key, null)
      } else {
        report.missingImages.push(`${path}：${target}${kind === 'wiki' && !imageExtensions.has(posix.extname(target).toLowerCase()) ? '（嵌入的不是图片）' : ''}`)
        images.set(key, null)
      }
    }

    for (const target of drawingTargets) {
      const resolved = resolveFile(idx, target, path, scope, null)
      if (resolved.kind !== 'found') throw new Error('画板源文件缺失：' + target)
      const pkg = JSON.parse(readFileSync(join(args.source, resolved.path), 'utf8')) as DrawingPackage
      const node = await importDrawingPackage(pkg, async src => {
        const sibling = join(args.source, posix.dirname(resolved.path), posix.basename(src))
        const data = readFileSync(sibling)
        if (createHash('sha256').update(data).digest('hex').slice(0, 32) !== posix.basename(src).split('.')[0]) throw new Error('画板图片与内容哈希不符：' + src)
        report.images++; report.imageBytes += data.length
        if (args.dry) return { url: src, mime: Object.values(pkg.files).find(f => f.src === src)!.mimeType }
        return await client.upload(data, posix.basename(src)) as { url: string; mime: string }
      }, async p => args.dry ? { type: 'drawing', attrs: { src: '/drawings/' + '0'.repeat(32), text: p.text, version: 1, width: 800, blockAlign: 'center', caption: '', previewMime: p.preview.mime, previewWidth: p.preview.width, previewHeight: p.preview.height } } : client.json<JSONContent>('POST', 'drawings', p))
      const { width: _w, blockAlign: _a, caption: _c, ...derived } = node.attrs!
      drawingAttrs.set(target, derived)
      report.drawings++
    }
    const issues: string[] = []
    for (const target of attachmentTargets) {
      const resolved = resolveFile(idx, target, path, scope, null)
      if (resolved.kind !== 'found') {
        attachmentAttrs.set(target, null)
        issues.push('附件无法导入：' + target + '（' + resolved.kind + '）')
        continue
      }
      let uploadedFile = uploadedAttachments.get(resolved.path)
      if (!uploadedFile) {
        const data = readFileSync(join(args.source, resolved.path))
        const asset = await client.upload(data, posix.basename(resolved.path), true) as { url: string; size?: number; mime?: string }
        uploadedFile = { ...asset, size: asset.size ?? data.length }
        uploadedAttachments.set(resolved.path, uploadedFile)
        report.attachments++
        report.attachmentBytes += data.length
      }
      attachmentAttrs.set(target, { src: uploadedFile.url, size: uploadedFile.size, ...(uploadedFile.mime ? { mime: uploadedFile.mime } : {}) })
    }
    const doc = markdownToDoc(markdown, {
      breaks,
      issue: (m) => issues.push(m),
      resolveDrawing: target => drawingAttrs.get(target) ?? null,
      resolveAttachment: target => attachmentAttrs.get(target) ?? null,
      resolveImage: (target, kind) => images.get(`${kind}|${target}`) ?? null,
      resolveLink: (target, kind) => {
        const [file, heading] = target.split('#')
        if (!file) return heading ? `#${heading}` : null
        const r = resolveFile(idx, file, path, scope, new Set(['.md']))
        if (r.kind === 'found' && docIds.has(r.path)) return `/docs/${docIds.get(r.path)}`
        if (r.kind === 'missing' && looksLikeHost(target)) {
          issues.push(`未写协议的外链 ${target} 按 https://${target} 导入`)
          return `https://${target}`
        }
        const written = kind === 'wiki' ? `[[${target}]]` : `[…](${target})`
        report.missingLinks.push(`${path}：${written}${r.kind === 'ambiguous' ? `（有多个同名笔记：${r.candidates.join('、')}）` : ''}`)
        return null
      },
    })
    if (issues.length) report.issues.set(path, [...new Set(issues)])

    walk(doc, (n) => {
      if (n.type === 'inlineMath' || n.type === 'blockMath') {
        const latex = String(n.attrs?.latex ?? '')
        try {
          katex.renderToString(latex, { throwOnError: true, strict: 'ignore', displayMode: n.type === 'blockMath' || needsDisplay(latex) })
        } catch (e) {
          report.math.push(`${path}：\`${String(n.attrs?.latex).slice(0, 80)}\` — ${(e as Error).message.split('\n')[0]}`)
        }
      }
      if (n.type === 'codeBlock') {
        const lang = String(n.attrs?.language ?? '（无）')
        report.languages.set(lang, (report.languages.get(lang) ?? 0) + 1)
      }
      if (n.type === 'callout') {
        const key = `${n.attrs?.type}${n.attrs?.fold ? ` (${n.attrs.fold})` : ''}`
        report.callouts.set(key, (report.callouts.get(key) ?? 0) + 1)
      }
    })

    // The editor keeps an empty paragraph after a final block; adding it here means opening an
    // imported note without typing does not save a change.
    const blocks = doc.content ?? []
    if (blocks.length && blocks[blocks.length - 1].type !== 'paragraph') doc.content = [...blocks, { type: 'paragraph' }]

    await client.json('PUT', `docs/${id}`, { title: posix.basename(path).replace(/\.md$/i, ''), content: doc, baseRevision: 1 })
  }

  writeReport(args, report, Date.now() - started)
}

function writeReport(args: Args, r: Report, ms: number) {
  const list = (items: string[], empty = '无') => (items.length ? items.map((i) => `- ${i}`).join('\n') : empty)
  const counts = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，')
  const out = `# 导入报告

生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}${args.dry ? '（演练，未写入）' : ''}
来源：\`${args.source}\`；目标：${args.server}；耗时 ${(ms / 1000).toFixed(1)} 秒

## 概要

- 知识库 ${r.books.length} 个，分组 ${r.groups} 个，文档 ${r.docs} 篇
- 画板 ${r.drawings} 个引用（包内图片计入下项）
- 图片 ${r.images} 个文件，共 ${(r.imageBytes / 1048576).toFixed(1)} MiB（服务端按内容去重）
- 附件 ${r.attachments} 个文件，共 ${(r.attachmentBytes / 1048576).toFixed(1)} MiB

| 知识库 | 文档 |
| --- | --- |
${r.books.map((b) => `| ${b.name} | ${b.docs} |`).join('\n')}

## 需要处理

### 同名但内容不同的图片（${r.ambiguous.length}）

在 overrides 文件中为每项指定一张：\`{"images": {"笔记路径|图片引用": "选中的文件路径"}}\`。

${list(r.ambiguous)}

### 找不到的图片（${r.missingImages.length}）

${list(r.missingImages)}

### 找不到的双链（${r.missingLinks.length}）

${list(r.missingLinks)}

### 外链图片（${r.externalImages.length}，保留原地址）

${list(r.externalImages)}

### KaTeX 无法渲染的公式（${r.math.length}）

${list(r.math)}

## 转换提示

${r.issues.size ? [...r.issues].map(([p, is]) => `- ${p}\n${is.map((i) => `  - ${i}`).join('\n')}`).join('\n') : '无'}

## 统计

- 代码语言：${counts(r.languages)}
- Callout：${counts(r.callouts)}
- 最大的文档：${[...r.largest].sort((a, b) => b.kb - a.kb).slice(0, 5).map((d) => `${d.path}（${d.kb} KiB）`).join('，')}
`
  mkdirSync(dirname(args.report), { recursive: true })
  writeFileSync(args.report, out)
  console.log(`导入完成：${r.books.length} 个知识库，${r.docs} 篇文档，${r.drawings} 个画板、${r.images} 张图片、${r.attachments} 个附件；报告 ${args.report}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
