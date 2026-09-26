import type { JSONContent } from '@tiptap/core'
import { docToMarkdown } from '../../schema/markdown'
import { counts, fold, lineDiff, titleDiff, type Block, type Part } from './diff'

// The comparison view loads this, and with it the diff library and the Markdown conversion, only
// when a comparison is opened.

export interface Side {
  title: string
  content: JSONContent
}

export interface Comparison {
  title: [Part[], Part[]] | null
  blocks: Block[]
  added: number
  removed: number
  changed: boolean
}

export function compareVersions(before: Side, after: Side): Comparison {
  const markdown = (s: Side) => docToMarkdown(s.content, { alignTables: false })
  const lines = lineDiff(markdown(before), markdown(after))
  return { title: titleDiff(before.title, after.title), blocks: fold(lines), ...counts(lines), changed: lines.some((l) => l.kind !== 'same') }
}
