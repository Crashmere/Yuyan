import type { Node as PMNode } from '@tiptap/pm/model'
import { headingIds } from '../shared/headingTools'

export interface HeadingSection {
  node: PMNode
  pos: number
  body: number
  end: number
  level: number
  parent: PMNode
  parentPos: number
  index: number
  endIndex: number
  id: string
}

const cache = new WeakMap<PMNode, HeadingSection[]>()

// Heading levels apply among siblings. A heading inside a column/cell never takes ownership
// of blocks in the next column/cell. Outer sections still include the whole containing block.
export function headingSections(doc: PMNode): HeadingSection[] {
  const cached = cache.get(doc)
  if (cached) return cached
  const sections: HeadingSection[] = []
  const visit = (parent: PMNode, parentPos: number) => {
    const start = parentPos + 1, stack: HeadingSection[] = []
    parent.forEach((node, offset, index) => {
      const pos = start + offset
      if (node.type.name === 'heading') {
        const level = Number(node.attrs.level)
        while (stack.length && stack.at(-1)!.level >= level) {
          const previous = stack.pop()!
          previous.end = pos; previous.endIndex = index
        }
        const section = { node, pos, body: pos + node.nodeSize, end: start + parent.content.size, level,
          parent, parentPos, index, endIndex: parent.childCount, id: '' }
        sections.push(section); stack.push(section)
      } else if (!node.isLeaf && !node.isTextblock) visit(node, pos)
    })
  }
  visit(doc, -1)
  const ids = headingIds(sections.map(section => section.node.textContent))
  sections.forEach((section, index) => { section.id = ids[index] })
  cache.set(doc, sections)
  return sections
}
