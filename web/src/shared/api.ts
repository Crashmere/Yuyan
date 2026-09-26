import type { JSONContent } from '@tiptap/core'

export const base = document.querySelector<HTMLMetaElement>('meta[name="yuyan-base"]')?.content ?? '/'

export interface Book {
  id: number
  name: string
  description: string
  position: number
  docCount: number
  updatedAt: string
}

export interface TreeNode {
  id: number
  parentId: number | null
  kind: 'doc' | 'group'
  title: string
  updatedAt: string
  children?: TreeNode[]
}

export interface DocMeta {
  id: number
  bookId: number
  parentId: number | null
  kind: 'doc' | 'group'
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  bookName: string
}

// Pixel sizes of a document's uploaded images, keyed by asset id.
export type ImageSizes = Record<string, [number, number]>

export interface Doc extends DocMeta {
  content: JSONContent
  images?: ImageSizes
}

export interface Heading {
  level: number
  text: string
  id: string
}

export interface DocView {
  doc: DocMeta
  html: string
  toc: Heading[]
  hasMath: boolean
  hasMermaid: boolean
  chars: number
  prev: { id: number; title: string } | null
  next: { id: number; title: string } | null
  children: TreeNode[]
  images: ImageSizes
}

export interface VersionInfo {
  id: number
  docId: number
  revision: number
  title: string
  reason: 'create' | 'autosave' | 'session' | 'restore'
  createdAt: string
}

export interface VersionView {
  version: VersionInfo
  doc: DocMeta
  html: string
  hasMath: boolean
  hasMermaid: boolean
  images: ImageSizes
}

// A document in the title index of the search panel.
export interface TitleEntry {
  id: number
  title: string
  bookId: number
  bookName: string
  path: string[]
}

export interface DocSummary {
  id: number
  bookId: number
  bookName: string
  title: string
  kind: 'doc' | 'group'
  updatedAt: string
}

export interface SearchHit {
  id: number
  bookId: number
  bookName: string
  title: string
  snippet: string
}

export interface TrashItem {
  kind: 'book' | 'doc'
  id: number
  title: string
  bookName: string
  deletedAt: string
}

export interface Asset {
  id: string
  ext: string
  url: string
  width?: number
  height?: number
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public revision?: number,
  ) {
    super(message)
  }
}

// Responses the server rendered into the page for the first screen, keyed by API path. Each is
// used once, so later navigation always asks the server again.
const preloaded: Record<string, { status: number; body: { error?: string; message?: string; revision?: number } }> = (() => {
  try {
    return JSON.parse(document.getElementById('yy-initial')?.textContent || '{}')
  } catch {
    return {}
  }
})()

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  if ((init.method ?? 'GET') === 'GET' && path in preloaded) {
    const { status, body } = preloaded[path]
    delete preloaded[path]
    if (status >= 400) throw new ApiError(status, body.error ?? 'error', body.message ?? '', body.revision)
    return body as T
  }
  const headers = new Headers(init.headers)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  let res: Response
  try {
    res = await fetch(`${base}api/${path}`, { ...init, headers, body })
  } catch {
    throw new ApiError(0, 'network', '网络连接失败')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText, data.revision)
  return data as T
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return '文档已在别处修改，请刷新后再试'
  return e instanceof Error ? e.message : String(e)
}

export function pageURL(path: string): string {
  return base + path
}

// Stored image src values are app-relative (/assets/<id>.png).
export function assetURL(src: string): string {
  return src.startsWith('/assets/') ? base.replace(/\/$/, '') + src : src
}

export function unassetURL(src: string): string {
  const prefix = base.replace(/\/$/, '') + '/assets/'
  return src.startsWith(prefix) ? src.slice(base.length - 1) : src
}

export async function uploadImage(file: File): Promise<Asset> {
  const form = new FormData()
  form.append('file', file, file.name || 'image.png')
  return api<Asset>('assets', { method: 'POST', body: form })
}
