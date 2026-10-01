import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { headingControl, readHeadingFolds, saveHeadingFolds } from '../shared/headingTools'
import { headingSections, type HeadingSection } from './sections'

interface Folds { positions: Set<number>; decorations: DecorationSet }
const foldsKey = new PluginKey<Folds>('headingFolds')

function toggle(view: EditorView, section: HeadingSection) {
  const folded = foldsKey.getState(view.state)!.positions.has(section.pos), tr = view.state.tr
  // Keep the caret visible when collapsing the section that currently contains it.
  const { from, to } = tr.selection
  if (!folded && from < section.end && to >= section.body) tr.setSelection(TextSelection.create(tr.doc, section.pos + 1))
  view.dispatch(tr.setMeta(foldsKey, { toggle: section.pos }).setMeta('addToHistory', false))
}

function decorations(sections: HeadingSection[], positions: Set<number>, doc: import('@tiptap/pm/model').Node): DecorationSet {
  const out: Decoration[] = [], hidden = new Set<number>()
  for (const section of sections) {
    const folded = positions.has(section.pos), foldable = section.body < section.end
    if (folded) {
      out.push(Decoration.node(section.pos, section.body, { class: 'is-folded' }))
      section.parent.forEach((node, offset) => {
        const pos = section.parentPos + 1 + offset
        if (pos >= section.body && pos < section.end && !hidden.has(pos)) {
          hidden.add(pos); out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'yy-folded-away' }))
        }
      })
    }
    out.push(Decoration.widget(section.pos + 1, view => {
      const control = headingControl(section.level, foldable ? folded : undefined)
      control.addEventListener('mousedown', event => event.preventDefault())
      if (foldable) control.addEventListener('click', event => {
        event.preventDefault()
        const current = headingSections(view.state.doc).find(s => s.pos === section.pos)
        if (current) toggle(view, current)
      })
      return control
    }, { side: -1, key: `heading:${section.pos}:${section.level}:${folded}:${foldable}`, ignoreSelection: true, stopEvent: () => true }))
  }
  return DecorationSet.create(doc, out)
}

export function revealHeadingAt(view: EditorView, pos: number) {
  view.dispatch(view.state.tr.setMeta(foldsKey, { reveal: pos }).setMeta('addToHistory', false))
}

export const HeadingFolds = Extension.create<{ key?: string }>({
  name: 'headingFolds',
  addOptions() { return { key: undefined } },
  addProseMirrorPlugins() {
    const key = this.options.key
    return [new Plugin<Folds>({
      key: foldsKey,
      state: {
        init(_, state) {
          const sections = headingSections(state.doc), saved = readHeadingFolds(key)
          const positions = new Set(sections.filter(section => saved.has(section.id) && section.body < section.end).map(section => section.pos))
          return { positions, decorations: decorations(sections, positions, state.doc) }
        },
        apply(tr, previous, oldState) {
          const action = tr.getMeta(foldsKey) as { toggle?: number; reveal?: number } | undefined
          if (!tr.docChanged && !tr.selectionSet && !action) return previous
          const sections = headingSections(tr.doc), positions = new Set<number>()
          for (const pos of previous.positions) {
            const mapped = tr.mapping.mapResult(pos, 1)
            const section = !mapped.deleted ? sections.find(s => s.pos === mapped.pos) : undefined
            // Moving a section preserves its heading nodes, including across undo/redo. A delete
            // removes them, while edits to a heading use the normal positional mapping above.
            const found = section ?? sections.find(s => s.node === oldState.doc.nodeAt(pos))
            if (found && found.body < found.end) positions.add(found.pos)
          }
          if (action?.toggle !== undefined) {
            if (positions.has(action.toggle)) positions.delete(action.toggle)
            else positions.add(action.toggle)
          } else {
            const points = action?.reveal !== undefined ? [action.reveal] : tr.selectionSet ? [tr.selection.from, tr.selection.to] : []
            for (const section of sections) {
              if (points.some(pos => pos >= section.body && pos < section.end)) positions.delete(section.pos)
            }
          }
          if (!tr.docChanged && positions.size === previous.positions.size && [...positions].every(pos => previous.positions.has(pos))) return previous
          return { positions, decorations: decorations(sections, positions, tr.doc) }
        },
      },
      props: { decorations: state => foldsKey.getState(state)!.decorations },
      view() {
        return { update(view, previous) {
          const current = foldsKey.getState(view.state)!
          if (current !== foldsKey.getState(previous)) saveHeadingFolds(key, headingSections(view.state.doc).filter(s => current.positions.has(s.pos)).map(s => s.id))
        } }
      },
    })]
  },
})
