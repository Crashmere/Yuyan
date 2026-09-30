export interface SelectionRange { from: number; to: number }

export function growsRange(candidate: SelectionRange, current: SelectionRange): boolean {
  return candidate.from <= current.from && candidate.to >= current.to
    && (candidate.from < current.from || candidate.to > current.to)
}

export function smallestRange(ranges: SelectionRange[], current: SelectionRange): SelectionRange | undefined {
  return ranges.filter(range => growsRange(range, current)).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]
}

// For a manual selection, rebuild the expansion path from its first position. Keep the last
// strictly smaller range fully inside it; an arbitrary drag must never grow while shrinking.
export function smallerRange<T extends SelectionRange>(current: SelectionRange, start: T, next: (range: T) => T | undefined, rangeOf: (value: T) => SelectionRange = value => value): T {
  let result = start
  for (;;) {
    const candidate = next(result)
    if (!candidate || !growsRange(current, rangeOf(candidate)) || !growsRange(rangeOf(candidate), rangeOf(result))) return result
    result = candidate
  }
}

// Native segmentation understands Chinese words as well as Latin words and emoji, without
// shipping a dictionary. All indices stay in UTF-16, as in ProseMirror and CodeMirror.
const words = new Intl.Segmenter('zh', { granularity: 'word' })
const sentences = new Intl.Segmenter('zh', { granularity: 'sentence' })

export function textRanges(text: string, current: SelectionRange, withSentences = true): SelectionRange[] {
  const ranges: SelectionRange[] = []
  if (!text.length) return ranges
  for (const segmenter of withSentences ? [words, sentences] : [words]) {
    const segments = segmenter.segment(text)
    let first = segments.containing(Math.min(current.from, text.length - 1))
    // At the end of a word, prefer that word over the following space/punctuation.
    if (current.from === current.to && !first?.isWordLike && current.from > 0 && segmenter === words) {
      const before = segments.containing(current.from - 1)
      if (before?.isWordLike) first = before
    }
    const last = current.from === current.to ? first : segments.containing(current.to - 1)
    if (!first || !last) continue
    const end = last.index + last.segment.length
    const value = text.slice(first.index, end)
    const from = first.index + value.length - value.trimStart().length
    const to = end - (value.length - value.trimEnd().length)
    if (from < to) ranges.push({ from, to })
  }
  return ranges
}
