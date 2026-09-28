// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { schemaExtensions } from '../src/schema/extensions'
import { shiftHeadingLevel } from '../src/editor/headingLevels'

let editor: Editor
afterEach(() => editor?.destroy())

describe('shifting selected heading levels', () => {
  it('changes only selected table cells, with all-or-nothing boundary checks and a read-only can()', () => {
    const cell = (level: number, text: string) => ({ type: 'tableHeader', content: [{ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }] })
    editor = new Editor({ extensions: schemaExtensions(), content: { type: 'doc', content: [
      { type: 'table', content: [
        { type: 'tableRow', content: [cell(2, '选中甲'), cell(1, '未选中甲')] },
        { type: 'tableRow', content: [cell(3, '选中乙'), cell(6, '未选中乙')] },
      ] },
    ] } })
    const cells: number[] = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableHeader') cells.push(pos) })
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[2] })
    const original = editor.getJSON()
    expect(editor.can().command(shiftHeadingLevel(-1))).toBe(true)
    expect(editor.getJSON()).toEqual(original)
    expect(editor.commands.command(shiftHeadingLevel(-1))).toBe(true)
    const levels = () => cells.map(pos => editor.state.doc.nodeAt(pos)!.firstChild!.attrs.level)
    expect(levels()).toEqual([1, 1, 2, 6])
    const promoted = editor.getJSON()
    expect(editor.commands.command(shiftHeadingLevel(-1))).toBe(false)
    expect(editor.getJSON()).toEqual(promoted)
    editor.commands.selectAll()
    expect(editor.commands.command(shiftHeadingLevel(1))).toBe(false)
    expect(editor.getJSON()).toEqual(promoted)
  })
})
