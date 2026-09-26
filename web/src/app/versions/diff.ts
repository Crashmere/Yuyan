import { diffArrays, diffLines, type ChangeObject } from 'diff'

// Two versions of a document compared line by line as Markdown, with the changed words marked
// inside edited lines (docs/DESIGN.md 13.2).

export interface Part {
  text: string
  changed: boolean
}

export type Line = { kind: 'same'; text: string } | { kind: 'removed' | 'added'; parts: Part[] }

// What the comparison shows: lines, and runs of unchanged lines folded away. start is the index
// of the block's first line.
export interface Block {
  kind: 'lines' | 'gap'
  start: number
  lines: Line[]
}

// Unchanged lines shown on each side of a change, not counting blank lines.
const context = 2
// Unchanged runs shorter than this are shown rather than folded.
const minGap = 4
// An edited line is paired with its new version when at least this share of its text is kept.
const minKept = 0.3
// In larger changed stretches, lines are only compared with lines about as far into the other side.
const fullPairing = 1000
const band = 8
const maxPairing = 250_000

// Latin words and numbers are compared whole; Chinese and Japanese, written without spaces, by
// character.
const token = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{N}\p{M}_])+|\s+|[^]/gu

function lineText(line: Line): string {
  return line.kind === 'same' ? line.text : line.parts.map((p) => p.text).join('')
}

function visible(text: string): number {
  let n = 0
  for (const c of text) if (!/\s/.test(c)) n++
  return n
}

function push(parts: Part[], text: string, changed: boolean) {
  const last = parts[parts.length - 1]
  if (last?.changed === changed) last.text += text
  else if (text) parts.push({ text, changed })
}

// Splits the two versions of an edited line into parts with the changed words marked, or gives
// null when they have too little in common for the marks to help.
export function inlineDiff(before: string, after: string): [Part[], Part[]] | null {
  return compareLine(before, after, Infinity)?.parts ?? null
}

// Like inlineDiff, with the share of the text that was kept.
function compareLine(before: string, after: string, deadline: number): { parts: [Part[], Part[]]; kept: number } | null {
  const a = before.match(token) ?? []
  const b = after.match(token) ?? []
  const timeout = deadline - Date.now()
  if (timeout <= 0) return null
  const changes = diffArrays(a, b, { maxEditLength: Math.ceil((a.length + b.length) * 0.75), timeout })
  if (!changes) return null
  const left: Part[] = []
  const right: Part[] = []
  let kept = 0
  changes.forEach((c, i) => {
    const text = c.value.join('')
    // A single character kept between two changes, such as 的 or a comma, is mostly a chance match;
    // marking it as changed too keeps the marks readable.
    const chance = !c.added && !c.removed && i > 0 && i < changes.length - 1 && visible(text) <= 1
    if (!c.added && !c.removed && !chance) {
      kept += visible(text)
      push(left, text, false)
      push(right, text, false)
      return
    }
    if (!c.added) push(left, text, true)
    if (!c.removed) push(right, text, true)
  })
  const share = kept / Math.max(visible(before), visible(after))
  return share >= minKept ? { parts: [left, right], kept: share } : null
}

function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function whole(kind: 'removed' | 'added', text: string): Line {
  return { kind, parts: text ? [{ text, changed: false }] : [] }
}

// Pairs removed lines with the added lines they were edited into, so an edited line is shown right
// above its new version; the rest are shown whole. Pairs keep the order of both sides, and the most
// similar lines win: after a list item is deleted, the renumbered next item pairs with itself.
function pair(removed: string[], added: string[], deadline: number): Line[] {
  const m = removed.length
  const n = added.length
  const pairs = new Map<number, { parts: [Part[], Part[]]; kept: number }>()
  if (m * n <= maxPairing) {
    for (let i = 0; i < m; i++) {
      if (!removed[i].trim()) continue
      const middle = Math.round(((i + 0.5) * n) / m)
      const [from, to] = m * n <= fullPairing ? [0, n] : [Math.max(0, middle - band), Math.min(n, middle + band)]
      for (let j = from; j < to && Date.now() < deadline; j++) {
        const p = added[j].trim() ? compareLine(removed[i], added[j], deadline) : null
        if (p) pairs.set(i * n + j, p)
      }
    }
  }
  if (!pairs.size) return [...removed.map((t) => whole('removed', t)), ...added.map((t) => whole('added', t))]
  // best[i][j]: the most similarity pairs can add up to among removed[i..] and added[j..].
  const best = new Float64Array((m + 1) * (n + 1))
  const at = (i: number, j: number) => i * (n + 1) + j
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const p = pairs.get(i * n + j)
      best[at(i, j)] = Math.max(best[at(i + 1, j)], best[at(i, j + 1)], p ? p.kept + best[at(i + 1, j + 1)] : 0)
    }
  }
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    const p = pairs.get(i * n + j)
    if (p && best[at(i, j)] === p.kept + best[at(i + 1, j + 1)]) {
      out.push({ kind: 'removed', parts: p.parts[0] }, { kind: 'added', parts: p.parts[1] })
      i++
      j++
    } else if (best[at(i + 1, j)] >= best[at(i, j + 1)]) {
      out.push(whole('removed', removed[i++]))
    } else {
      out.push(whole('added', added[j++]))
    }
  }
  while (i < m) out.push(whole('removed', removed[i++]))
  while (j < n) out.push(whole('added', added[j++]))
  return out
}

// The lines of two texts marked as unchanged, removed or added. Comparing very different long
// texts gives up after a moment and shows the old text removed and the new one added.
export function lineDiff(before: string, after: string): Line[] {
  const changes: ChangeObject<string>[] = diffLines(before, after, { ignoreNewlineAtEof: true, timeout: 1000 }) ?? [
    { value: before, count: 0, added: false, removed: true },
    { value: after, count: 0, added: true, removed: false },
  ]
  const deadline = Date.now() + 500
  const out: Line[] = []
  for (let i = 0; i < changes.length; ) {
    if (!changes[i].added && !changes[i].removed) {
      for (const text of splitLines(changes[i++].value)) out.push({ kind: 'same', text })
      continue
    }
    const removed: string[] = []
    const added: string[] = []
    for (; i < changes.length && (changes[i].added || changes[i].removed); i++) {
      for (const text of splitLines(changes[i].value)) (changes[i].added ? added : removed).push(text)
    }
    for (const line of pair(removed, added, deadline)) out.push(line)
  }
  return out
}

// Splits the lines into blocks to show and runs of unchanged lines to fold, keeping a little
// context around each change.
export function fold(lines: Line[]): Block[] {
  const shown = lines.map((l) => l.kind !== 'same')
  const walk = (from: number, step: number) => {
    let distance = Infinity
    for (let i = from; i >= 0 && i < lines.length; i += step) {
      const l = lines[i]
      if (l.kind !== 'same') {
        distance = 0
        continue
      }
      const blank = !l.text.trim()
      if (!blank) distance++
      if (blank ? distance < context : distance <= context) shown[i] = true
    }
  }
  walk(0, 1)
  walk(lines.length - 1, -1)
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; ) {
    let j = i
    while (j < lines.length && shown[j] === shown[i]) j++
    const kind = shown[i] || j - i < minGap ? 'lines' : 'gap'
    const last = blocks[blocks.length - 1]
    if (kind === 'lines' && last?.kind === 'lines') last.lines.push(...lines.slice(i, j))
    else blocks.push({ kind, start: i, lines: lines.slice(i, j) })
    i = j
  }
  return blocks
}

// Added and removed lines, not counting blank ones.
export function counts(lines: Line[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.kind === 'same' || !lineText(l).trim()) continue
    if (l.kind === 'added') added++
    else removed++
  }
  return { added, removed }
}

export function titleDiff(before: string, after: string): [Part[], Part[]] | null {
  if (before === after) return null
  return inlineDiff(before, after) ?? [[{ text: before, changed: true }], [{ text: after, changed: true }]]
}
