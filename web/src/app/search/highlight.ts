import { termPattern } from '../../shared/searchMatch'

// parts splits text around case-insensitive matches of the query's words, for highlighting.
export function parts(text: string, query: string): { text: string; hit: boolean }[] {
  const pattern = termPattern(query)
  if (!pattern) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), hit: false })
    const last = out[out.length - 1]
    if (last?.hit && m.index === at) last.text += m[0]
    else out.push({ text: m[0], hit: true })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}
