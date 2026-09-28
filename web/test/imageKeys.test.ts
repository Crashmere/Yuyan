// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { schemaExtensions } from '../src/schema/extensions'
import { deleteAtImage } from '../src/editor/imageKeys'

let editor: Editor
afterEach(() => editor?.destroy())

const image = { type: 'image', attrs: { src: '/assets/example.png', blockAlign: 'center' } }
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const heading = (level: number): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: `标题 ${level}` }] })

it.each(['blockquote', 'tableCell'])('protects headings beside images inside %s without changing the container', container => {
  const blocks = [heading(2), p(image), heading(3)]
  const node = container === 'blockquote' ? { type: container, content: blocks }
    : { type: 'table', content: [{ type: 'tableRow', content: [{ type: container, content: blocks }] }] }
  editor = new Editor({ extensions: schemaExtensions(), content: { type: 'doc', content: [node] } })
  const original = editor.getJSON()
  let imagePos = 0, nextHeading = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image') imagePos = pos
    if (node.type.name === 'heading' && node.attrs.level === 3) nextHeading = pos + 1
  })
  editor.commands.setTextSelection(nextHeading)
  const before = editor.state.selection.toJSON()
  expect(deleteAtImage(-1)(editor.state)).toBe(true)
  expect(editor.state.selection.toJSON()).toEqual(before)
  expect(deleteAtImage(-1)(editor.state, editor.view.dispatch)).toBe(true)
  expect(editor.state.selection).toBeInstanceOf(NodeSelection)
  expect(editor.state.selection.from).toBe(imagePos)
  expect(editor.getJSON()).toEqual(original)
})

it('does not cross a table cell boundary when moving out of an image line', () => {
  editor = new Editor({ extensions: schemaExtensions(), content: { type: 'doc', content: [
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [p(image)] }, { type: 'tableCell', content: [p({ type: 'text', text: '另一格' })] },
    ] }] },
  ] } })
  const original = editor.getJSON()
  let pos = 0
  editor.state.doc.descendants((node, at) => { if (node.type.name === 'image') pos = at })
  for (const direction of [-1, 1] as const) {
    const cursor = pos + (direction === 1 ? 1 : 0)
    editor.commands.setTextSelection(cursor)
    expect(deleteAtImage(direction)(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.selection.from).toBe(cursor)
    expect(editor.getJSON()).toEqual(original)
  }
})
