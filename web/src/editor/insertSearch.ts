import { score, units } from '../shared/searchMatch'
import { insertItems, type InsertItem } from './commands'

const index = insertItems.map(item => ({
  item,
  spelled: units(item.pinyin),
  keywords: item.keywords.split(/\s+/),
  syntax: [item.markdown, ...(item.syntax ?? [])].filter((s): s is string => !!s),
}))

// Share Cmd+K's text/pinyin ranking. Syntax also supports partial input, with exact forms first
// (e.g. ## selects heading 2 ahead of heading 3). Ties keep the original menu order.
export function searchInsertItems(query: string): InsertItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return insertItems
  return index
    .map(({ item, spelled, keywords, syntax }) => ({
      item,
      rank: Math.max(
        score(item.label, spelled, q),
        ...keywords.map(keyword => score(keyword, [], q)),
        ...syntax.map(s => s.toLowerCase() === q ? 5 : score(s, [], q)),
      ),
    }))
    .filter(({ rank }) => rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .map(({ item }) => item)
}
