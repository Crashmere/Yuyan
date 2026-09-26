// parts splits text around case-insensitive matches of the query, for highlighting.
export function parts(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase()
  if (!q) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  const lower = text.toLowerCase()
  let at = 0
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false })
    out.push({ text: text.slice(i, i + q.length), hit: true })
    at = i + q.length
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}
