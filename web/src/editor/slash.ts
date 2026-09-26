import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import SlashMenu from './SlashMenu.vue'

export interface SlashItem {
  title: string
  hint: string
  keywords: string
  run: (editor: Editor) => void
}

export interface SlashOptions {
  items: SlashItem[]
}

function filter(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.includes(q))
}

function place(el: HTMLElement, rect: (() => DOMRect | null) | null | undefined) {
  const r = rect?.()
  if (!r) return
  computePosition({ getBoundingClientRect: () => r }, el, {
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  }).then(({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` }))
}

// A "/" menu for inserting blocks. With a Chinese IME the same key types "、", so both open it.
export const SlashCommand = Extension.create<SlashOptions>({
  name: 'slashCommand',

  addOptions() {
    return { items: [] }
  },

  addProseMirrorPlugins() {
    return ['/', '、'].map((char, i) =>
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey(`slashCommand${i}`),
        char,
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filter(this.options.items, query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run()
          props.run(editor)
        },
        render: () => {
          let component: VueRenderer | null = null
          return {
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
              component = new VueRenderer(SlashMenu, { props, editor: props.editor })
              const el = component.element as HTMLElement
              document.body.appendChild(el)
              place(el, props.clientRect)
            },
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
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
