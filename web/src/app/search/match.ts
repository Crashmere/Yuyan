// Pinyin matching for the search panel. The server spells each title as units separated by spaces:
// one per Chinese character with its readings separated by "/", and one per run of letters and
// digits, e.g. "01 zui/cuo duan lu/luo" for 01 最短路. Each character can be typed in full
// (zuiduanlu), by its initial (zdl) or partly (zuidl), starting at any character.

export type Units = string[][]

export function units(pinyin: string): Units {
  return pinyin
    .split(' ')
    .filter(Boolean)
    .map((u) => u.split('/'))
}

// A query that may be pinyin: letters and digits, with spaces or apostrophes between syllables.
export function pinyinQuery(query: string): string | null {
  const q = query.toLowerCase().replace(/[\s']+/g, '')
  return /^[a-z0-9]+$/.test(q) ? q : null
}

// The index of the unit where q matches, preferring the earliest, or -1. q comes from pinyinQuery.
export function pinyinMatch(spelled: Units, q: string): number {
  const failed = new Set<number>()
  const from = (u: number, p: number): boolean => {
    if (p === q.length) return true
    if (u === spelled.length || failed.has(u * (q.length + 1) + p)) return false
    for (const reading of spelled[u]) {
      let n = 0
      while (n < reading.length && reading[n] === q[p + n]) n++
      for (let k = n; k > 0; k--) if (from(u + 1, p + k)) return true
    }
    failed.add(u * (q.length + 1) + p)
    return false
  }
  for (let start = 0; start < spelled.length; start++) if (from(start, 0)) return start
  return -1
}

// How well a title or name matches what was typed, for ordering: containing the text beats
// matching its pinyin, and starting with it beats matching further in. 0 is no match.
export function score(text: string, spelled: Units, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const i = text.toLowerCase().indexOf(q)
  if (i >= 0) return i === 0 ? 4 : 3
  const p = pinyinQuery(q)
  const j = p ? pinyinMatch(spelled, p) : -1
  return j < 0 ? 0 : j === 0 ? 2 : 1
}
