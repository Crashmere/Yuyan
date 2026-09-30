import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { insertItems, type InsertItem } from './commands'
import { searchInsertItems } from './insertSearch'
import type { EditorUi } from './context'
import SlashMenu from './SlashMenu.vue'

export interface SlashEntry extends InsertItem {
  recent?: boolean
}

const recentKey = 'yuyan:slash-recent'

function recentIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey) ?? '[]') as string[]
  } catch {
    return []
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(recentKey, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 5)))
  } catch {
    // storage unavailable
  }
}

// With no query the menu starts with recent items; searching uses the shared text/pinyin matcher
// and the insert commands' Markdown aliases.
function filter(query: string): SlashEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    const recent = recentIds()
      .map((id) => insertItems.find((i) => i.id === id))
      .filter((i): i is InsertItem => !!i)
      .map((i) => ({ ...i, recent: true }))
    return [...recent, ...insertItems]
  }
  return searchInsertItems(q)
}

function place(el: HTMLElement, rect: (() => DOMRect | null) | null | undefined) {
  const r = rect?.()
  if (!r) return
  void computePosition({ getBoundingClientRect: () => r }, el, {
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  }).then(({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` }))
}

// A "/" menu for inserting blocks. With a Chinese IME the same key types "、", so both open it.
export const SlashCommand = Extension.create<{ ui: EditorUi | null }>({
  name: 'slashCommand',

  addOptions() {
    return { ui: null }
  },

  addProseMirrorPlugins() {
    const ui = this.options.ui
    return ['/', '、'].map((char, i) =>
      Suggestion<SlashEntry, SlashEntry>({
        editor: this.editor,
        pluginKey: new PluginKey(`slashCommand${i}`),
        char,
        allowSpaces: true,
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filter(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashEntry }) => {
          editor.chain().focus().deleteRange(range).run()
          remember(props.id)
          if (ui) props.run(editor, ui)
        },
        render: () => {
          let component: VueRenderer | null = null
          return {
            onStart: (props: SuggestionProps<SlashEntry, SlashEntry>) => {
              component = new VueRenderer(SlashMenu, { props, editor: props.editor })
              const el = component.element as HTMLElement
              document.body.appendChild(el)
              place(el, props.clientRect)
            },
            onUpdate: (props: SuggestionProps<SlashEntry, SlashEntry>) => {
              component?.updateProps(props)
              place(component?.element as HTMLElement, props.clientRect)
            },
            onKeyDown: ({ event }: { event: KeyboardEvent }) => {
              if (event.key === 'Escape') {
                component?.element?.remove()
                return true
              }
              return (component?.ref as { onKeyDown?: (e: KeyboardEvent) => boolean } | null)?.onKeyDown?.(event) ?? false
            },
            onExit: () => {
              component?.element?.remove()
              component?.destroy()
              component = null
            },
          }
        },
      }),
    )
  },
})
