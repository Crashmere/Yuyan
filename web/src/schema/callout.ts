import { Node } from '@tiptap/core'

// Obsidian-style callout: > [!type]± Title. The DOM matches Obsidian's (div.callout >
// div.callout-title + div.callout-content) so existing callout CSS can be reused.
// fold: '' = not foldable, '+' = foldable and open, '-' = foldable and collapsed.
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'calloutTitle calloutContent',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (el) => el.getAttribute('data-callout') || 'note',
        renderHTML: () => ({}),
      },
      fold: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-callout-fold') || '',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div.callout' }]
  },

  renderHTML({ node }) {
    const fold = node.attrs.fold as string
    const attrs: Record<string, string> = {
      class: fold === '-' ? 'callout is-collapsed' : 'callout',
      'data-callout': String(node.attrs.type || 'note').toLowerCase(),
    }
    if (fold === '+' || fold === '-') attrs['data-callout-fold'] = fold
    return ['div', attrs, 0]
  },
})

export const CalloutTitle = Node.create({
  name: 'calloutTitle',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'div.callout-title' }]
  },
  renderHTML() {
    return ['div', { class: 'callout-title' }, 0]
  },
})

export const CalloutContent = Node.create({
  name: 'calloutContent',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div.callout-content' }]
  },
  renderHTML() {
    return ['div', { class: 'callout-content' }, 0]
  },
})

export const calloutTypes = [
  'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote', 'code',
]
