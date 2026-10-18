import { calendarText, type CalendarData } from '../schema/calendar'
import type { Node as PMNode } from '@tiptap/pm/model'

// Counts like the reading page and the directory (doc.PlainText and doc.CountChars in Go):
// text, formula source, image alt text and captions, attachment names, code block titles and
// drawing text, without whitespace. Unchanged nodes are shared between document versions, so
// after an edit only the changed blocks are counted again.
const space = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/
const counted = new WeakMap<PMNode, number>()

function visible(text: unknown): number {
  if (typeof text !== 'string') return 0
  let n = 0
  for (const c of text) if (!space.test(c)) n++
  return n
}

export function countCharacters(node: PMNode): number {
  if (node.isText) return visible(node.text)
  const cached = counted.get(node)
  if (cached !== undefined) return cached
  const a = node.attrs
  let n = 0
  switch (node.type.name) {
    case 'inlineMath':
    case 'blockMath': n = visible(a.latex); break
    case 'calendar': n = visible(calendarText(a as CalendarData)); break
    case 'drawing': n = visible(a.text) + visible(a.caption); break
    case 'attachment': n = visible(a.name); break
    case 'image': n = visible(a.alt) + visible(a.caption); break
    case 'codeBlock': n = visible(a.title); break
  }
  node.forEach(child => { n += countCharacters(child) })
  counted.set(node, n)
  return n
}
