// Exports every knowledge base as Markdown plus images that Obsidian can open:
//   npm --prefix web run export -- --server http://127.0.0.1:18084/yuyan/ --out ~/YuyanExport
// Running it again into the same folder refreshes the Markdown and downloads only missing images,
// so an interrupted export can simply be restarted. --dry converts every document and checks that
// every image exists, without writing anything.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { JSONContent } from '@tiptap/core'
import { attachmentsDir, exportDoc, metaDir, planExport, type ExportBook, type ExportEntry, type ExportTreeNode } from '../../src/shared/export'

interface Args {
  server: string
  out: string
  dry: boolean
}

interface Manifest {
  tool: 'yuyan-export'
  exportedAt: string
  entries: ExportEntry[]
  dirs: string[]
  assets: string[]
}

interface Report {
  books: number
  groups: number
  docs: number
  assets: number
  downloaded: number
  downloadedBytes: number
  renamed: string[]
  missingLinks: string[]
  failedAssets: string[]
}

const concurrency = 4

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const server = get('server')
  const out = get('out')
  const dry = argv.includes('--dry')
  if (!server || (!out && !dry)) throw new Error('usage: export --server <http://host/yuyan/> --out <folder> [--dry]')
  return {
    server: server.replace(/\/?$/, '/'),
    // npm --prefix runs scripts inside web/; relative paths mean the directory npm was started from.
    out: out ? resolve(process.env.INIT_CWD ?? process.cwd(), out.replace(/^~(?=\/|$)/, homedir())) : '',
    dry,
  }
}

// The server is reached over a slow link, so each request is retried a few times.
async function request(url: URL, method = 'GET'): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method })
      if (res.ok || res.status === 404 || attempt === 4) return res
    } catch (e) {
      if (attempt === 4) throw e
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

async function getJSON<T>(base: string, path: string): Promise<T> {
  const res = await request(new URL(`api/${path}`, base))
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

function progress(label: string, done: number, total: number, extra = '') {
  if (process.stdout.isTTY) process.stdout.write(`\r${label} ${done}/${total}${extra}   `)
  else if (done === total || done % 100 === 0) console.log(`${label} ${done}/${total}${extra}`)
  if (done === total && process.stdout.isTTY) process.stdout.write('\n')
}

// An asset's name is the first 128 bits of the SHA-256 of its bytes.
function assetMatches(file: string, data: Uint8Array): boolean {
  return createHash('sha256').update(data).digest('hex').slice(0, 32) === file.slice(0, 32)
}

function writeAtomic(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.part-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

// The target folder must be new, empty, or the result of an earlier export; files it did not
// write itself are never touched.
function previousExport(out: string): Manifest | null {
  if (!existsSync(out)) return null
  const manifest = join(out, metaDir, 'manifest.json')
  if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')) as Manifest
  if (readdirSync(out).every((n) => n === '.DS_Store')) return null
  throw new Error(`${out} 不是空文件夹，也不是之前的导出结果，请换一个文件夹`)
}

function removeStale(out: string, previous: Manifest, current: Manifest) {
  const keep = new Set([...current.entries.flatMap((e) => (e.file ? [e.file] : [])), ...current.assets.map((a) => `${attachmentsDir}/${a}`)])
  const old = [...previous.entries.flatMap((e) => (e.file ? [e.file] : [])), ...previous.assets.map((a) => `${attachmentsDir}/${a}`)]
  for (const file of old) if (!keep.has(file)) rmSync(join(out, file), { force: true })
  const dirs = new Set(current.dirs)
  for (const dir of [...previous.dirs].sort((a, b) => b.length - a.length)) {
    if (dirs.has(dir)) continue
    try {
      rmdirSync(join(out, dir))
    } catch {
      // not empty: it holds files the export did not create
    }
  }
}

function countNodes(nodes: ExportTreeNode[], kind: string): number {
  return nodes.reduce((n, c) => n + (c.kind === kind ? 1 : 0) + countNodes(c.children ?? [], kind), 0)
}

function formatReport(args: Args, r: Report, ms: number): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '无')
  return `# 导出报告

导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}${args.dry ? '（演练，未写入文件）' : ''}；耗时 ${(ms / 1000).toFixed(1)} 秒

- 知识库 ${r.books} 个，分组 ${r.groups} 个，文档 ${r.docs} 篇
- 图片与附件 ${r.assets} 个${args.dry ? '' : `，本次下载 ${r.downloaded} 个（${(r.downloadedBytes / 1048576).toFixed(1)} MiB），其余已存在且校验通过`}

## 下载失败或不存在的图片与附件（${r.failedAssets.length}）

${args.dry ? '' : '重新运行导出会继续下载缺少的图片与附件。\n\n'}${list(r.failedAssets)}

## 指向不存在文档的链接（${r.missingLinks.length}）

这些链接指向已删除（在回收站中）或不存在的文档，导出时保留原样。

${list(r.missingLinks)}

## 文件名与标题不同（${r.renamed.length}）

标题含有文件名不允许的字符，或与同级重名。

${list(r.renamed)}
`
}

async function main() {
  const args = parseArgs()
  const started = Date.now()
  const previous = args.dry ? null : previousExport(args.out)

  const bookList = await getJSON<{ id: number; name: string }[]>(args.server, 'books')
  const books: ExportBook[] = []
  for (const b of bookList) books.push({ id: b.id, name: b.name, tree: await getJSON<ExportTreeNode[]>(args.server, `books/${b.id}/tree`) })
  const plan = planExport(books)
  const report: Report = {
    books: books.length,
    groups: books.reduce((n, b) => n + countNodes(b.tree, 'group'), 0),
    docs: books.reduce((n, b) => n + countNodes(b.tree, 'doc'), 0),
    assets: 0,
    downloaded: 0,
    downloadedBytes: 0,
    renamed: plan.renamed.map((r) => `${r.book} / ${r.title} → ${r.name}`),
    missingLinks: [],
    failedAssets: [],
  }

  if (!args.dry) for (const dir of plan.dirs) mkdirSync(join(args.out, dir), { recursive: true })

  const docs = [...plan.entries.values()].filter((e) => e.kind === 'doc')
  const assetUsers = new Map<string, string>()
  const assetURLs: Record<string, string> = {}
  let converted = 0
  await pool(docs, async (entry) => {
    const { content } = await getJSON<{ content: JSONContent }>(args.server, `docs/${entry.id}`)
    const out = exportDoc(content, entry.file!, plan)
    Object.assign(assetURLs, out.assetURLs)
    for (const a of out.assets) if (!assetUsers.has(a)) assetUsers.set(a, entry.file!)
    for (const href of out.missingLinks) report.missingLinks.push(`${entry.file}：${href}`)
    if (!args.dry) writeAtomic(join(args.out, entry.file!), out.markdown)
    progress('文档', ++converted, docs.length)
  })

  const assets = [...assetUsers.keys()].sort()
  report.assets = assets.length
  let checked = 0
  await pool(assets, async (file) => {
    const url = new URL(assetURLs[file].replace(/^\//, ''), args.server)
    try {
      if (args.dry) {
        const res = await request(url, 'HEAD')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } else {
        const path = join(args.out, attachmentsDir, file)
        if (!existsSync(path) || !assetMatches(file, readFileSync(path))) {
          const res = await request(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = new Uint8Array(await res.arrayBuffer())
          if (!assetMatches(file, data)) throw new Error('内容与图片与附件 ID 不符')
          writeAtomic(path, data)
          report.downloaded++
          report.downloadedBytes += data.length
        }
      }
    } catch (e) {
      report.failedAssets.push(`${file}（${assetUsers.get(file)}）：${e instanceof Error ? e.message : e}`)
    }
    progress('图片与附件', ++checked, assets.length, args.dry ? '' : `，已下载 ${(report.downloadedBytes / 1048576).toFixed(1)} MiB`)
  })

  report.missingLinks.sort()
  report.failedAssets.sort()
  const text = formatReport(args, report, Date.now() - started)
  if (args.dry) {
    console.log(`\n${text}`)
  } else {
    const manifest: Manifest = {
      tool: 'yuyan-export',
      exportedAt: new Date().toISOString(),
      entries: [...plan.entries.values()],
      dirs: plan.dirs,
      assets: assets.filter((a) => !report.failedAssets.some((f) => f.startsWith(a))),
    }
    if (previous) removeStale(args.out, previous, manifest)
    writeAtomic(join(args.out, metaDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    writeAtomic(join(args.out, metaDir, 'report.md'), text)
    console.log(`导出到 ${args.out}：${report.docs} 篇文档，${report.assets} 个图片与附件；报告 ${join(metaDir, 'report.md')}`)
  }
  if (report.failedAssets.length) {
    console.error(`${report.failedAssets.length} 个图片与附件${args.dry ? '不存在' : '下载失败，重新运行可以继续'}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
