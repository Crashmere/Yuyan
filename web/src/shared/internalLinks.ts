import { api, base, type Heading } from './api'
import { score, units } from './searchMatch'

export interface LinkTarget { id: number; title: string; bookName: string; pinyin: string; headings: (Heading & { pinyin: string })[] }
export interface LinkChoice { href: string; label: string; detail: string; heading: boolean; doc: LinkTarget }
export interface LinkPreview { title: string; bookName: string; heading: string; snippet: string }

export function internalTarget(href: string): { id: number; heading: string } | null {
  try {
    const url = new URL(href, location.href)
    if (url.origin !== location.origin) return null
    const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length - 1) : url.pathname
    const match = /^\/docs\/(\d+)$/.exec(path)
    if (!match) return null
    return { id: Number(match[1]), heading: decodeURIComponent(url.hash.slice(1)) }
  } catch { return null }
}

export function previewLink(href: string): Promise<LinkPreview> {
  const target = internalTarget(href)
  if (!target) return Promise.reject(new Error('不是本站文档链接'))
  return api(`docs/${target.id}/preview${target.heading ? `?heading=${encodeURIComponent(target.heading)}` : ''}`)
}

export function linkChoices(docs: LinkTarget[], query: string, expanded: number | null): LinkChoice[] {
  const q = query.trim().toLowerCase()
  const out: { choice: LinkChoice; rank: number }[] = []
  for (const d of docs) {
    const rank = q ? score(d.title, units(d.pinyin), q) : 1
    if (rank > 0) out.push({ rank, choice: { href: `/docs/${d.id}`, label: d.title, detail: d.bookName, heading: false, doc: d } })
    for (const h of d.headings) {
      if (!q && expanded !== d.id) continue
      const headingRank = q ? score(h.text, units(h.pinyin), q) : 1
      if (headingRank <= 0) continue
      out.push({ rank: headingRank, choice: { href: `/docs/${d.id}#${encodeURIComponent(h.id)}`, label: h.text, detail: `${d.bookName} · ${d.title}`, heading: true, doc: d } })
    }
  }
  if (q) out.sort((a, b) => b.rank - a.rank || Number(a.choice.heading) - Number(b.choice.heading))
  return out.slice(0, 80).map(row => row.choice)
}
