import type { Command } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'

// Check every selected heading before changing any of them. Cell selections can have disjoint
// ranges, so walking from selection.from to selection.to would also touch unselected cells.
export function shiftHeadingLevel(delta: -1 | 1): Command {
  return ({ tr, dispatch }) => {
    const headings = new Map<number, Node>()
    for (const { $from, $to } of tr.selection.ranges) {
      tr.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (node.type.name === 'heading') headings.set(pos, node)
      })
    }
    if (!headings.size || [...headings.values()].some(node => node.attrs.level + delta < 1 || node.attrs.level + delta > 6)) return false
    if (dispatch) {
      for (const [pos, node] of headings) tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: node.attrs.level + delta })
    }
    return true
  }
}
