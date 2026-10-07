import { drawingDependencies } from '../drawing/portable'
import type { DrawingPackage } from '../drawing/types'
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { api, base, type Doc, type TreeNode } from '../shared/api'
import { attachmentsDir, exportDoc, fileName, planNodes } from '../shared/export'

// Exports part of a knowledge base from the browser with the same layout as the export tool: a
// single document without images is one Markdown file; anything else is a zip of Markdown files
// and an attachments folder. Loaded only when the user exports, since the Markdown converter is
// large. Links to documents outside the export point back to the web app.

export interface ExportResult {
  filename: string
  docs: number
  images: number
  failedImages: number
}

const concurrency = 4

async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function exportNodes(book: string, nodes: TreeNode[], zipName: string, progress: (message: string) => void): Promise<ExportResult> {
  const plan = planNodes(book, nodes)
  const docs = [...plan.entries.values()].filter((e) => e.kind === 'doc')
  const webURL = (href: string) => new URL(base.replace(/\/$/, '') + href, location.origin).href
  const markdown = new Map<string, string>()
  const assets = new Set<string>()
  const assetURLs: Record<string, string> = {}
  let done = 0
  await pool(docs, async (entry) => {
    const doc = await api<Doc>(`docs/${entry.id}`)
    const out = exportDoc(doc.content, entry.file!, plan, webURL)
    const deps = await drawingDependencies(doc.content, id => api<DrawingPackage>(`drawings/${id}`))
    Object.assign(assetURLs, deps)
    for (const name of Object.keys(deps)) assets.add(name)
    markdown.set(entry.file!, out.markdown)
    Object.assign(assetURLs, out.assetURLs)
    for (const a of out.assets) assets.add(a)
    progress(`正在导出文档 ${++done}/${docs.length}`)
  })

  if (docs.length === 1 && plan.dirs.length === 0 && assets.size === 0) {
    const [[file, text]] = [...markdown]
    download(new Blob([text], { type: 'text/markdown;charset=utf-8' }), file)
    return { filename: file, docs: 1, images: 0, failedImages: 0 }
  }

  const chunks: Uint8Array[] = []
  let finish: () => void = () => {}
  let fail: (e: Error) => void = () => {}
  const zipped = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  const zip = new Zip((err, chunk, final) => {
    if (err) fail(err)
    else {
      chunks.push(chunk)
      if (final) finish()
    }
  })
  const add = (path: string, data: Uint8Array, compress: boolean) => {
    const entry = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path)
    zip.add(entry)
    entry.push(data, true)
  }
  for (const dir of plan.dirs) add(`${dir}/`, new Uint8Array(0), false)
  for (const [file, text] of markdown) add(file, strToU8(text), true)

  // Images are already compressed, so they are stored as they are.
  const images = [...assets].sort()
  let fetched = 0
  let failedImages = 0
  await pool(images, async (name) => {
    try {
      const res = await fetch(`${base}${assetURLs[name].replace(/^\//, '')}`)
      if (!res.ok) throw new Error(String(res.status))
      add(`${attachmentsDir}/${name}`, new Uint8Array(await res.arrayBuffer()), false)
    } catch {
      failedImages++
    }
    progress(`正在下载图片与附件 ${++fetched}/${images.length}`)
  })
  zip.end()
  await zipped
  const filename = `${fileName(zipName)}.zip`
  download(new Blob(chunks as BlobPart[], { type: 'application/zip' }), filename)
  return { filename, docs: docs.length, images: images.length - failedImages, failedImages }
}
