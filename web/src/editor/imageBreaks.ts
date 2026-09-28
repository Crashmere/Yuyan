import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, TextSelection, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

interface Item { node: PMNode; pos: number }
interface Block extends Item { items: Item[] }
interface Row { bottom: number; last: number }

function imageBlocks(doc: PMNode): Block[] {
  const blocks: Block[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const items: Item[] = []
    node.forEach((child, offset) => items.push({ node: child, pos: pos + 1 + offset }))
    if (items.some(item => item.node.type.name === 'image')) blocks.push({ node, pos, items })
    return false
  })
  return blocks
}

function imageElement(view: EditorView, pos: number): HTMLImageElement | null {
  const dom = view.nodeDOM(pos)
  return dom instanceof HTMLElement ? dom.querySelector('img') : null
}

// Only explains line structure. Spacing, the native caret, keyboard handling and deletion
// remain the editor's existing behavior; the labels never become document content.
class ImageBreakView {
  private layer = document.createElement('div')
  private frame = 0
  private observer: ResizeObserver
  private blocks: Block[] = []
  private active: Block[] = []
  private clipTop = 0

  constructor(private view: EditorView) {
    this.layer.className = 'yy-image-break-layer'
    this.layer.setAttribute('aria-hidden', 'true')
    document.body.append(this.layer)
    this.observer = new ResizeObserver(this.schedule)
    window.addEventListener('scroll', this.schedule, true)
    window.addEventListener('resize', this.schedule)
    view.dom.addEventListener('focusin', this.schedule)
    view.dom.addEventListener('focusout', this.schedule)
    view.dom.addEventListener('mousedown', this.mousedown, true)
    this.update(view)
  }

  private schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint() })
  }

  update(view: EditorView, previous?: EditorState) {
    this.view = view
    if (previous?.doc === view.state.doc && previous.selection.eq(view.state.selection)) return
    if (previous?.doc !== view.state.doc) this.blocks = imageBlocks(view.state.doc)
    const { from, to } = view.state.selection
    this.active = this.blocks.filter(block => [from, to].some(pos => pos > block.pos && pos < block.pos + block.node.nodeSize))
    this.observer.disconnect()
    this.observer.observe(view.dom)
    for (const block of this.active) for (const item of block.items) {
      if (item.node.type.name !== 'image') continue
      const img = imageElement(view, item.pos)
      if (img) this.observer.observe(img)
    }
    this.schedule()
  }

  private marker(text: string, x: number, y: number) {
    if (y < this.clipTop || y > innerHeight || x < 0 || x > innerWidth) return
    const marker = document.createElement('span')
    marker.className = 'yy-image-flow-marker'
    marker.textContent = text
    Object.assign(marker.style, { left: `${Math.max(2, x)}px`, top: `${y}px` })
    this.layer.append(marker)
    const width = marker.getBoundingClientRect().width
    if (x + width > innerWidth - 4) marker.style.left = `${Math.max(4, innerWidth - width - 4)}px`
  }

  private paint() {
    const view = this.view
    this.layer.replaceChildren()
    if (!view.editable || !view.hasFocus() || view.composing) return
    this.clipTop = document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0
    for (const block of this.active) {
      let previous: DOMRect | null = null, previousAligned = false
      for (const item of block.items) {
        if (item.node.type.name === 'hardBreak') {
          const r = view.coordsAtPos(item.pos)
          this.marker('↵ 手动换行', (previous?.right ?? r.left) + 2, (previous?.top ?? r.top) + 2)
          previous = null; previousAligned = false
        } else if (item.node.type.name === 'image') {
          const img = imageElement(view, item.pos)
          if (!img?.getClientRects().length) continue
          const r = img.getBoundingClientRect()
          if (previous && r.top >= previous.bottom - 1 && !previousAligned && !item.node.attrs.blockAlign) this.marker('↳ 自动折行', r.left + 2, r.top - 12)
          previous = r; previousAligned = !!item.node.attrs.blockAlign
        } else if (item.node.isText && /\S/.test(item.node.text!)) previous = null
      }
      const last = block.items.at(-1)
      const endImage = last?.node.type.name === 'image' ? imageElement(view, last.pos) : null
      const end = endImage?.getBoundingClientRect() ?? view.coordsAtPos(block.pos + block.node.nodeSize - 1)
      this.marker('¶ 段落结束', end.right + 2, end.top + 2)
    }
  }

  private mousedown = (event: MouseEvent) => {
    const view = this.view
    if (!view.editable || view.composing || event.button !== 0 || event.detail > 1 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('img, .yy-image-handle, button, input')) return
    const block = this.blocks.find(block => {
      const dom = view.nodeDOM(block.pos)
      return dom instanceof HTMLElement && dom.contains(target)
    })
    if (!block) return
    // Restrict the special click behavior to the blank space between automatic image rows.
    let row: Row | null = null
    for (const item of block.items) {
      if (item.node.type.name !== 'image') {
        if (!(item.node.isText && !/\S/.test(item.node.text!))) row = null
        continue
      }
      if (item.node.attrs.blockAlign) { row = null; continue }
      const img = imageElement(view, item.pos)
      if (!img?.getClientRects().length) continue
      const r = img.getBoundingClientRect()
      if (row && r.top >= row.bottom - 1) {
        if (event.clientY > row.bottom && event.clientY < r.top) {
          const pos = r.top - event.clientY <= event.clientY - row.bottom ? item.pos : row.last
          event.preventDefault(); event.stopImmediatePropagation()
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
          view.focus()
          return
        }
        row = null
      }
      if (row) { row.bottom = Math.max(row.bottom, r.bottom); row.last = item.pos + item.node.nodeSize }
      else row = { bottom: r.bottom, last: item.pos + item.node.nodeSize }
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame); this.observer.disconnect()
    window.removeEventListener('scroll', this.schedule, true); window.removeEventListener('resize', this.schedule)
    this.view.dom.removeEventListener('focusin', this.schedule); this.view.dom.removeEventListener('focusout', this.schedule)
    this.view.dom.removeEventListener('mousedown', this.mousedown, true)
    this.layer.remove()
  }
}

export const ImageBreaks = Extension.create({
  name: 'imageBreaks',
  addProseMirrorPlugins() { return [new Plugin({ view: view => new ImageBreakView(view) })] },
})
