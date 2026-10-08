import type { Editor } from '@tiptap/core'
import type { EditorState, Selection } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { commitSelectionChange, type SelectedNode } from './selectionContent'

const cache = new WeakMap<Selection, { doc: EditorState['doc']; tables: SelectedNode[] }>()

// A caret acts on its nearest table. Use each real selection range so disjoint selections
// do not include intervening tables; partial cell selections act on their containing table.
export function tablesInSelection({ doc, selection }: Pick<EditorState, 'doc' | 'selection'>): SelectedNode[] {
  const cached = cache.get(selection)
  if (cached?.doc === doc) return cached.tables
  const tables = new Map<number, SelectedNode>()
  if (selection.empty) {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const node = selection.$from.node(depth)
      if (node.type.name !== 'table') continue
      const pos = selection.$from.before(depth)
      tables.set(pos, { node, pos })
      break
    }
  } else {
    for (const { $from, $to } of selection.ranges) {
      doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (node.type.name === 'table') tables.set(pos, { node, pos })
      })
    }
  }
  const result = [...tables.values()]
  cache.set(selection, { doc, tables: result })
  return result
}

// Let the browser measure intrinsic column widths with the actual fonts, marks, padding and
// spans. A hidden clone outside ProseMirror never changes the document or the visible layout.
function measureTable(e: Editor, { node, pos }: SelectedNode): number[] | null {
  const dom = e.view.nodeDOM(pos)
  const source = dom instanceof HTMLTableElement ? dom : dom instanceof Element ? dom.querySelector('table') : null
  if (!source) return null
  const map = TableMap.get(node)
  const host = document.createElement('div')
  host.className = `${e.view.dom.className} yy-table-fit-measure`
  host.inert = true
  host.setAttribute('aria-hidden', 'true')
  const table = source.cloneNode(true) as HTMLTableElement
  host.appendChild(table)
  table.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
  table.querySelectorAll('colgroup, .column-resize-handle, .ProseMirror-widget, button').forEach(el => el.remove())
  table.querySelectorAll('[data-collapsed]').forEach(el => el.setAttribute('data-collapsed', 'false'))
  table.querySelectorAll('details').forEach(el => el.open = true)
  table.querySelectorAll('.yy-folded-away').forEach(el => el.classList.remove('yy-folded-away'))
  // CodeMirror may render only a viewport or hide folded lines. Measure its complete source,
  // using the same font, line padding and gutter instead of the visible DOM fragment.
  const codeBlocks = [...table.querySelectorAll('.yy-codeblock')]
  let codeIndex = 0
  node.descendants(child => {
    if (child.type.name !== 'codeBlock') return
    const block = codeBlocks[codeIndex++]
    const content = block?.querySelector('.cm-content')
    if (!content) return
    const lines = document.createDocumentFragment()
    for (const text of child.textContent.split('\n')) {
      const line = document.createElement('div')
      line.className = 'cm-line'
      line.textContent = text
      lines.appendChild(line)
    }
    content.replaceChildren(lines)
  })
  // An extra empty row exposes every logical column, including columns present only in spans.
  const probe = table.createTBody().insertRow()
  for (let col = 0; col < map.width; col++) probe.insertCell()
  e.view.dom.parentElement!.appendChild(host)
  try {
    return Array.from(probe.cells, cell => Math.ceil(cell.getBoundingClientRect().width))
  } finally {
    host.remove()
  }
}

export function fitTableColumns(e: Editor): boolean {
  if (!e.isEditable) return false
  const tr = e.state.tr
  // Fit inner tables first; the browser still measures their intrinsic content in outer tables.
  for (const target of tablesInSelection(e.state).reverse()) {
    const widths = measureTable(e, target)
    if (!widths?.every(width => Number.isFinite(width) && width > 0)) continue
    const map = TableMap.get(target.node)
    for (const rel of new Set(map.map)) {
      const pos = target.pos + 1 + rel
      const cell = tr.doc.nodeAt(pos)
      if (!cell || !['cell', 'header_cell'].includes(cell.type.spec.tableRole ?? '')) continue
      const rect = map.findCell(rel)
      const colwidth = widths.slice(rect.left, rect.right)
      if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth)) {
        tr.setNodeMarkup(pos, undefined, { ...cell.attrs, colwidth })
      }
    }
  }
  return commitSelectionChange(e, tr)
}
