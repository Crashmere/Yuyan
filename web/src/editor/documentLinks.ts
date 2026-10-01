import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { exitSuggestion } from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import DocLinkPicker from './DocLinkPicker.vue'
import type { LinkChoice } from '../shared/internalLinks'

const key = new PluginKey('documentLink')
export const DocumentLinks = Extension.create({
  name: 'documentLinks',
  addProseMirrorPlugins() {
    const thisEditor = this.editor
    return [Suggestion<LinkChoice>({
      editor: this.editor, pluginKey: key, char: '[[', allowedPrefixes: null, allowSpaces: true,
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code && !state.doc.resolve(range.from).marks().some(mark => mark.type.name === 'code'),
      command: ({ editor, range, props }) => {
        // Consume an already typed closing pair as well.
        const to = editor.state.doc.textBetween(range.to, Math.min(editor.state.doc.content.size, range.to + 2)) === ']]' ? range.to + 2 : range.to
        const marks = editor.state.doc.resolve(range.from).marks().filter(mark => mark.type.name !== 'link').map(mark => mark.toJSON())
        editor.chain().focus().insertContentAt({ from: range.from, to }, { type: 'text', text: props.label, marks: [...marks, { type: 'link', attrs: { href: props.href } }] })
          .command(({ tr }) => { tr.setStoredMarks(tr.selection.$from.marks().filter(mark => mark.type.name !== 'link')); return true }).run()
      },
      render: () => {
        let component: VueRenderer | null = null
        let currentRect: (() => DOMRect | null) | null | undefined
        let cleanup = () => {}
        function place(rect?: (() => DOMRect | null) | null) {
          if (rect) currentRect = rect
          const r = currentRect?.(), el = component?.element as HTMLElement | undefined
          if (!r || !el) return
          void computePosition({ getBoundingClientRect: () => r }, el, { strategy: 'fixed', placement: 'bottom-start', middleware: [offset(6), flip(), shift({ padding: 8 })] }).then(({ x, y }) => { if (el.isConnected) Object.assign(el.style, { left: `${x}px`, top: `${y}px` }) })
        }
        return {
          onStart(props) {
            component = new VueRenderer(DocLinkPicker, { editor: props.editor, props })
            const el = component.element as HTMLElement
            el.classList.add('yy-doc-link-suggestion'); document.body.append(el); currentRect = props.clientRect
            cleanup = autoUpdate({ getBoundingClientRect: () => currentRect?.() ?? new DOMRect(), contextElement: props.editor.view.dom }, el, () => place())
          },
          onUpdate(props) { component?.updateProps(props); place(props.clientRect) },
          onKeyDown({ event }) {
            if (event.key === 'Escape' && !event.isComposing) { exitSuggestion(thisEditor.view, key); return true }
            return (component?.ref as { onKeyDown?: (e: KeyboardEvent) => boolean })?.onKeyDown?.(event) ?? false
          },
          onExit() { cleanup(); component?.element?.remove(); component?.destroy(); component = null },
        }
      },
    })]
  },
})
