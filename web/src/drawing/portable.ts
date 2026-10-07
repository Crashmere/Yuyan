import type { JSONContent } from '@tiptap/core'
import { drawingSource } from '../schema/drawing'
import type { DrawingPackage } from './types'

export function drawingSources(content: JSONContent): string[] {
  const sources = new Set<string>()
  const walk = (n: JSONContent) => {
    if (n.type === 'drawing') sources.add(String(n.attrs?.src ?? ''))
    n.content?.forEach(walk)
  }
  walk(content)
  return [...sources]
}

// Exact stored packages are exported beside their original images. The package
// keeps content-addressed references; reimport uploads siblings then rewrites IDs.
export async function drawingDependencies(content: JSONContent, read: (id: string) => Promise<DrawingPackage>): Promise<Record<string, string>> {
  const urls: Record<string, string> = {}
  for (const src of drawingSources(content)) {
    const match = drawingSource.exec(src)
    if (!match) throw new Error('无效的画板地址：' + src)
    const p = await read(match[1])
    for (const f of Object.values(p.files)) {
      if (!/^\/assets\/[0-9a-f]{32}\.(png|jpg|gif|webp|bmp)$/.test(f.src)) throw new Error('无效的画板图片地址')
      urls[f.src.slice('/assets/'.length)] = f.src
    }
  }
  return urls
}

export async function importDrawingPackage(
  pkg: DrawingPackage,
  image: (src: string) => Promise<{ url: string; mime: string }>,
  publish: (pkg: DrawingPackage) => Promise<JSONContent>,
): Promise<JSONContent> {
  if (pkg.format !== 'yuyan-drawing' || pkg.version !== 1 || pkg.engine !== 'excalidraw' || pkg.engineVersion !== '0.18.1') throw new Error('不支持的画板包版本，请更新 Yuyan')
  const copy = structuredClone(pkg)
  for (const [id, file] of Object.entries(copy.files)) {
    if (!/^\/assets\/[0-9a-f]{32}\.(png|jpg|gif|webp|bmp)$/.test(file.src)) throw new Error('无效的画板图片依赖')
    const asset = await image(file.src)
    copy.files[id] = { src: asset.url, mimeType: asset.mime }
  }
  return publish(copy)
}
