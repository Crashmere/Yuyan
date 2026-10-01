import { Selection, type SelectionBookmark } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Mappable } from '@tiptap/pm/transform'

// A chapter is a range of complete sibling blocks. TextSelection trims edge images/tables;
// this selection keeps exact block boundaries for copying, deleting and the next expansion.
export class SectionSelection extends Selection {
  static create(doc: PMNode, from: number, to: number) { return new SectionSelection(doc.resolve(from), doc.resolve(to)) }
  eq(other: Selection) { return other instanceof SectionSelection && other.from === this.from && other.to === this.to }
  map(doc: PMNode, mapping: Mappable) { return this.getBookmark().map(mapping).resolve(doc) }
  content() { return this.$from.doc.slice(this.from, this.to) }
  toJSON() { return { type: 'yuyan-section', from: this.from, to: this.to } }
  static fromJSON(doc: PMNode, value: { from: number; to: number }) { return SectionSelection.create(doc, value.from, value.to) }
  getBookmark(): SelectionBookmark { return new SectionBookmark(this.from, this.to) }
}

class SectionBookmark implements SelectionBookmark {
  constructor(readonly from: number, readonly to: number) {}
  map(mapping: Mappable) { return new SectionBookmark(mapping.map(this.from, 1), mapping.map(this.to, -1)) }
  resolve(doc: PMNode): Selection {
    const from = Math.max(0, Math.min(this.from, doc.content.size)), to = Math.max(from, Math.min(this.to, doc.content.size))
    return from < to ? SectionSelection.create(doc, from, to) : Selection.near(doc.resolve(from))
  }
}

Selection.jsonID('yuyan-section', SectionSelection)
