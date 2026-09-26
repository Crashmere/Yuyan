import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// Find and replace. Matches are searched within each text block; inline formulas and images count
// as one placeholder character, so a match never spans them and positions map one to one.

export interface Match {
  from: number
  to: number
}

interface SearchState {
  term: string
  caseSensitive: boolean
  matches: Match[]
  current: number
}

interface SearchMeta {
  term?: string
  caseSensitive?: boolean
  current?: number
}

export const searchKey = new PluginKey<SearchState>('yySearch')
const empty: SearchState = { term: '', caseSensitive: false, matches: [], current: -1 }

export function findMatches(doc: PMNode, term: string, caseSensitive: boolean): Match[] {
  if (!term) return []
  const needle = caseSensitive ? term : term.toLowerCase()
  const out: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? child.text! : '\ufffc'.repeat(child.nodeSize)
    })
    const hay = caseSensitive ? text : text.toLowerCase()
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length })
    }
    return false
  })
  return out
}

export function searchState(state: EditorState): SearchState {
  return searchKey.getState(state) ?? empty
}

export const Search = Extension.create({
  name: 'yySearch',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => empty,
          apply(tr, prev) {
            const meta = tr.getMeta(searchKey) as SearchMeta | undefined
            if (!meta && !(tr.docChanged && prev.term)) return prev
            const term = meta?.term ?? prev.term
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive
            const matches = findMatches(tr.doc, term, caseSensitive)
            let current = meta?.current ?? prev.current
            if (meta?.term !== undefined || meta?.caseSensitive !== undefined) {
              // A new search starts at the first match after the cursor.
              const after = matches.findIndex((m) => m.from >= tr.selection.from)
              current = matches.length ? (after >= 0 ? after : 0) : -1
            }
            if (current >= matches.length) current = matches.length - 1
            return { term, caseSensitive, matches, current }
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state)
            if (!s?.matches.length) return null
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'yy-find-match current' : 'yy-find-match' })),
            )
          },
        },
      }),
    ]
  },
})

function select(view: EditorView, m: Match | undefined) {
  if (!m) return
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView())
}

export function setSearch(view: EditorView, term: string, caseSensitive: boolean) {
  view.dispatch(view.state.tr.setMeta(searchKey, { term, caseSensitive }))
  const s = searchState(view.state)
  select(view, s.matches[s.current])
}

export function gotoMatch(view: EditorView, step: 1 | -1) {
  const s = searchState(view.state)
  if (!s.matches.length) return
  const current = (s.current + step + s.matches.length) % s.matches.length
  view.dispatch(view.state.tr.setMeta(searchKey, { current }))
  select(view, s.matches[current])
}

export function replaceCurrent(view: EditorView, replacement: string) {
  const s = searchState(view.state)
  const m = s.matches[s.current]
  if (!m) return
  const tr = view.state.tr
  if (replacement) tr.insertText(replacement, m.from, m.to)
  else tr.delete(m.from, m.to)
  view.dispatch(tr)
  const next = searchState(view.state)
  select(view, next.matches[next.current])
}

export function replaceAll(view: EditorView, replacement: string): number {
  const s = searchState(view.state)
  if (!s.matches.length) return 0
  const tr = view.state.tr
  for (const m of [...s.matches].reverse()) {
    if (replacement) tr.insertText(replacement, m.from, m.to)
    else tr.delete(m.from, m.to)
  }
  view.dispatch(tr)
  return s.matches.length
}

export function clearSearch(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(searchKey, { term: '' }))
}
