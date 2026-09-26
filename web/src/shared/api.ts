import type { JSONContent } from '@tiptap/core'

export const base = document.querySelector<HTMLMetaElement>('meta[name="yuyan-base"]')?.content ?? '/'

export interface Doc {
  id: number
  bookId: number
  parentId: number | null
  kind: 'doc' | 'group'
  title: string
  content: JSONContent
  revision: number
  updatedAt: string
  bookName: string
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

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
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
