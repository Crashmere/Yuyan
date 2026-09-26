import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { tablesToReshape } from '../src/editor/tables'
import { markdownToDoc } from '../src/schema/markdown'
import { schemaExtensions } from '../src/schema/extensions'

const schema = getSchema(schemaExtensions())

function doc(md: string) {
  const node = PMNode.fromJSON(schema, markdownToDoc(md))
  node.check()
  return node
}

const cell = (type: 'tableHeader' | 'tableCell', text: string, align: string | null = null) => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('tablesToReshape', () => {
  it('leaves tables from Markdown alone, including their column alignment', () => {
    expect(tablesToReshape(doc('| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |'))).toBe(0)
  })

  it('handles rows shorter than the header, as imported notes have them', () => {
    const ragged = doc('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |\n| 1 | 2 | 3 | 4 |')
    expect(ragged.firstChild!.child(1).childCount).toBe(2)
    expect(tablesToReshape(ragged)).toBe(0)
  })

  it('reports tables without a header row or with mixed alignment in a column', () => {
    const table = (rows: ReturnType<typeof cell>[][]) =>
      PMNode.fromJSON(schema, { type: 'doc', content: [{ type: 'table', content: rows.map((r) => ({ type: 'tableRow', content: r })) }] })
    expect(tablesToReshape(table([[cell('tableCell', 'a')], [cell('tableCell', '1')]]))).toBe(1)
    expect(tablesToReshape(table([[cell('tableHeader', 'a', 'center')], [cell('tableCell', '1')]]))).toBe(1)
    expect(tablesToReshape(table([[cell('tableHeader', 'a', 'center')], [cell('tableCell', '1', 'center')]]))).toBe(0)
  })
})
