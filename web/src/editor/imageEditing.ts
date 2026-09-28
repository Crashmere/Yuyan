import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { imageGap, imagePairs } from '../shared/imageFlow'

interface Item { node: PMNode; pos: number }
interface Block extends Item { items: Item[] }
type Edge = 'before' | 'after'
interface CursorHint { pos: number; edge: Edge }
interface EditingState {
  blocks: Block[]
  active: Block[]
  decorations: DecorationSet
  hint: CursorHint | null
  armed: (CursorHint & { at: number }) | null
}
export const imageEditingKey = new PluginKey<EditingState>('imageEditing')

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

function build(state: EditorState, blocks: Block[], hint: CursorHint | null, armed: EditingState['armed']): EditingState {
  const { from, to } = state.selection
  const active = blocks.filter(block => [from, to].some(pos => pos > block.pos && pos < block.pos + block.node.nodeSize))
  const decorations: Decoration[] = []
  for (const block of blocks) {
    const runs = new Set<Item>(), next = new Set<Item>()
    for (const pair of imagePairs(block.items, ({ node }) => node.type.name === 'image' ? 'image' : node.type.name === 'hardBreak' ? 'break' : node.isText && /^[\s\u00a0]*$/.test(node.text!) ? 'space' : 'other')) {
      runs.add(pair.before); runs.add(pair.after); next.add(pair.before)
      if (!pair.lineBreak && !pair.before.node.attrs.blockAlign && !pair.after.node.attrs.blockAlign) {
        decorations.push(Decoration.widget(pair.before.pos + pair.before.node.nodeSize, imageGap, { side: 1, marks: [], ignoreSelection: true, key: `image-gap-${pair.before.pos}` }))
      }
    }
    for (const item of runs) decorations.push(Decoration.node(item.pos, item.pos + item.node.nodeSize, { class: `yy-image-run${next.has(item) ? ' yy-image-run-next' : ''}` }))
    if (!active.includes(block)) continue
    const onlyImages = block.items.every(item => item.node.type.name === 'image' || item.node.type.name === 'hardBreak' || (item.node.isText && !/\S/.test(item.node.text!)))
    decorations.push(Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: `yy-image-flow-active${onlyImages ? ' yy-image-flow-only' : ''}` }))
    for (const item of block.items) {
      if (!item.node.isText) continue
      for (const match of item.node.text!.matchAll(/[ \u00a0\t]/g)) {
        const pos = item.pos + match.index!
        decorations.push(Decoration.inline(pos, pos + 1, { class: 'yy-image-space', 'data-space': match[0] === '\t' ? '→' : '·', 'data-tip': match[0] === '\t' ? '制表符' : '空格' }))
      }
    }
  }
  return { blocks, active, decorations: DecorationSet.create(state.doc, decorations), hint, armed }
}

function imageElement(view: EditorView, pos: number): HTMLImageElement | null {
  const dom = view.nodeDOM(pos)
  return dom instanceof HTMLElement ? dom.querySelector('img') : null
}

function selectEdge(view: EditorView, pos: number, edge: Edge) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).setMeta(imageEditingKey, { hint: { pos, edge }, armed: null }))
  view.focus()
}

function resumeInsertion(view: EditorView) {
  const armed = imageEditingKey.getState(view.state)?.armed
  if (!armed) return false
  selectEdge(view, armed.pos, armed.edge)
  return true
}

interface Point { x: number; y: number; height: number; image?: HTMLImageElement }
function caretPoint(view: EditorView): Point | null {
  const sel = view.state.selection
  if (!(sel instanceof TextSelection) || !sel.empty) return null
  const state = imageEditingKey.getState(view.state)!
  const block = state.active.find(b => sel.from > b.pos && sel.from < b.pos + b.node.nodeSize)
  if (!block) return null
  const before = sel.$from.nodeBefore, after = sel.$from.nodeAfter
  const edge = state.hint?.pos === sel.from ? state.hint.edge : before?.type.name === 'image' ? 'after' : 'before'
  const item = edge === 'after' && before?.type.name === 'image' ? { pos: sel.from - before.nodeSize, edge } : after?.type.name === 'image' ? { pos: sel.from, edge: 'before' } : before?.type.name === 'image' ? { pos: sel.from - before.nodeSize, edge: 'after' } : null
  if (item) {
    const img = imageElement(view, item.pos)
    if (!img?.getClientRects().length) return null
    const r = img.getBoundingClientRect()
    const mixed = block.items.some(i => i.node.isText && /\S/.test(i.node.text!))
    const native = mixed ? view.coordsAtPos(sel.from, item.edge === 'before' ? -1 : 1) : null
    return { x: item.edge === 'before' ? r.left : r.right, y: native && native.bottom - native.top < 40 ? native.top : r.top + 2, height: Math.max(16, Math.min(24, r.height - 4)), image: img }
  }
  // Inside actual whitespace, use its real text coordinates, at the same height as image edges.
  if ((before?.isText && /[ \u00a0\t]$/.test(before.text!)) || (after?.isText && /^[ \u00a0\t]/.test(after.text!)) || before?.type.name === 'hardBreak' || after?.type.name === 'hardBreak') {
    const r = view.coordsAtPos(sel.from)
    return { x: r.left, y: r.top, height: 22 }
  }
  return null
}

function navigate(view: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing || view.composing || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
  const sel = view.state.selection
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const forward = event.key === 'ArrowRight'
    if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
      selectEdge(view, forward ? sel.to : sel.from, forward ? 'after' : 'before')
      return true
    }
    if (!(sel instanceof TextSelection) || !sel.empty) return false
    const next = forward ? sel.$from.nodeAfter : sel.$from.nodeBefore
    if (next?.type.name !== 'image') return false
    const pos = forward ? sel.from : sel.from - next.nodeSize
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).setMeta(imageEditingKey, { hint: null, armed: null }))
    return true
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
  const point = caretPoint(view)
  if (!point) return false
  const state = imageEditingKey.getState(view.state)!
  const block = state.active.find(b => sel.from > b.pos && sel.from < b.pos + b.node.nodeSize)
  if (!block) return false
  const down = event.key === 'ArrowDown'
  const rowY = point.image?.getBoundingClientRect().top ?? point.y
  const candidates = block.items.filter(i => i.node.type.name === 'image').flatMap(item => {
    const el = imageElement(view, item.pos)
    if (!el?.getClientRects().length) return []
    const r = el.getBoundingClientRect()
    if (down ? r.top <= rowY + 4 : r.top >= rowY - 4) return []
    return [{ pos: item.pos, edge: 'before' as const, x: r.left, y: r.top }, { pos: item.pos + item.node.nodeSize, edge: 'after' as const, x: r.right, y: r.top }]
  })
  candidates.sort((a, b) => Math.abs(a.y - rowY) - Math.abs(b.y - rowY) || Math.abs(a.x - point.x) - Math.abs(b.x - point.x))
  const target = candidates[0]
  if (!target) return false
  selectEdge(view, target.pos, target.edge)
  return true
}

export function imageEditingPlugin(deleteAtImage: (direction: -1 | 1) => Command) {
  return new Plugin<EditingState>({
    key: imageEditingKey,
    state: {
      init: (_, state) => build(state, imageBlocks(state.doc), null, null),
      apply(tr, previous, oldState, state) {
        const meta = tr.getMeta(imageEditingKey)
        if (!tr.docChanged && !tr.selectionSet && !meta) return previous
        const unchanged = state.selection.eq(oldState.selection) && !tr.docChanged
        const hint = meta && 'hint' in meta ? meta.hint : unchanged ? previous.hint : null
        const armed = meta && 'armed' in meta ? meta.armed && { ...meta.armed, at: performance.now() } : unchanged ? previous.armed : null
        return build(state, tr.docChanged ? imageBlocks(state.doc) : previous.blocks, hint, armed)
      },
    },
    props: {
      decorations: state => imageEditingKey.getState(state)!.decorations,
      handleDOMEvents: {
        keydown(view, event) {
          if (event.isComposing || view.composing) return false
          const image = view.state.selection instanceof NodeSelection && view.state.selection.node.type.name === 'image'
          if (image && event.repeat && ['Backspace', 'Delete'].includes(event.key)) { event.preventDefault(); return true }
          if (['Backspace', 'Delete'].includes(event.key) && deleteAtImage(event.key === 'Backspace' ? -1 : 1)(view.state, view.dispatch, view)) { event.preventDefault(); return true }
          if (navigate(view, event)) { event.preventDefault(); return true }
          if ((event.key.length === 1 || event.key === 'Enter') && !event.metaKey && !event.ctrlKey && !event.altKey) resumeInsertion(view)
          return false
        },
        beforeinput(view, event) {
          const input = event as InputEvent
          if (input.isComposing || view.composing) return false
          if (input.inputType.startsWith('insert')) {
            const resumed = resumeInsertion(view)
            // WebKit captures the replacement range before beforeinput. Merely moving the
            // selection here still lets it replace the previously selected image.
            if (resumed && input.data !== null) {
              event.preventDefault()
              view.dispatch(view.state.tr.insertText(input.data).scrollIntoView())
              return true
            }
            if (resumed && ['insertParagraph', 'insertLineBreak'].includes(input.inputType)) {
              event.preventDefault()
              const enter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: input.inputType === 'insertLineBreak' })
              view.someProp('handleKeyDown', handle => handle(view, enter))
              return true
            }
            return false
          }
          const direction = /^delete.*Backward$/.test(input.inputType) ? -1 : /^delete.*Forward$/.test(input.inputType) ? 1 : 0
          const armed = imageEditingKey.getState(view.state)?.armed
          // Virtual keyboards may repeat deletion without a keydown/repeat signal.
          if (direction && armed && performance.now() - armed.at < 350) {
            view.dispatch(view.state.tr.setMeta(imageEditingKey, { armed }))
            event.preventDefault(); return true
          }
          if (direction && deleteAtImage(direction)(view.state, view.dispatch, view)) { event.preventDefault(); return true }
          return false
        },
        compositionstart(view) { resumeInsertion(view); return false },
      },
      handlePaste(view) { resumeInsertion(view); return false },
      handleTextInput(view, _from, _to, text) {
        if (!resumeInsertion(view)) return false
        view.dispatch(view.state.tr.insertText(text).scrollIntoView())
        return true
      },
    },
    view: view => new ImageEditingView(view),
  })
}

class ImageEditingView {
  private layer = document.createElement('div')
  private frame = 0
  private observer: ResizeObserver
  private observed: PMNode | null = null
  private active = ''
  private clipTop = 0
  private dragCleanup = () => {}
  constructor(private view: EditorView) {
    this.layer.className = 'yy-image-editing-layer'
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
  private schedule = () => { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint() }) }
  update(view: EditorView, previous?: EditorState) {
    this.view = view
    if (previous && imageEditingKey.getState(previous) === imageEditingKey.getState(view.state)) return
    const state = imageEditingKey.getState(view.state)!
    const active = state.active.map(b => b.pos).join(',')
    if (this.observed !== view.state.doc || this.active !== active) {
      this.observed = view.state.doc; this.active = active; this.observer.disconnect()
      for (const block of state.active) for (const item of block.items) {
        if (item.node.type.name !== 'image') continue
        const img = imageElement(view, item.pos)
        if (img) this.observer.observe(img)
      }
    }
    this.schedule()
  }
  private marker(text: string, label: string, x: number, y: number, kind: string) {
    if (y < this.clipTop || y > innerHeight || x < 0 || x > innerWidth) return
    const marker = document.createElement('span')
    marker.className = `yy-image-flow-marker ${kind}`
    marker.textContent = text
    marker.dataset.tip = label
    Object.assign(marker.style, { left: `${Math.max(2, x)}px`, top: `${y}px` })
    this.layer.append(marker)
    const width = marker.getBoundingClientRect().width
    if (x + width > innerWidth - 4) marker.style.left = `${Math.max(4, innerWidth - width - 4)}px`
  }
  private paint() {
    const view = this.view
    this.layer.replaceChildren()
    view.dom.classList.remove('yy-image-caret-active')
    if (!view.editable || !view.hasFocus() || view.composing) return
    this.clipTop = document.querySelector('.yy-toolbar')?.getBoundingClientRect().bottom ?? 0
    const state = imageEditingKey.getState(view.state)!
    for (const block of state.active) {
      let previous: DOMRect | null = null, previousAligned = false, hardBreak = false
      for (const item of block.items) {
        if (item.node.type.name === 'hardBreak') {
          const r = view.coordsAtPos(item.pos)
          this.marker('↵ 手动换行', '手动换行 · Shift+Enter', (previous?.right ?? r.left) + 2, (previous?.top ?? r.top) + 2, 'is-break')
          previous = null; previousAligned = false; hardBreak = true
        } else if (item.node.type.name === 'image') {
          const img = imageElement(view, item.pos)
          if (!img?.getClientRects().length) continue
          const r = img.getBoundingClientRect()
          this.observer.observe(img)
          const aligned = previousAligned || !!item.node.attrs.blockAlign
          if (previous && r.top >= previous.bottom - 1 && !hardBreak) this.marker(aligned ? '↤ 单独对齐' : '↳ 自动折行', aligned ? '图片单独对齐成行' : '自动折行 · 随可用宽度排列', r.left + 2, r.top - 12, 'is-wrap')
          previous = r; previousAligned = !!item.node.attrs.blockAlign; hardBreak = false
        } else if (item.node.isText && /\S/.test(item.node.text!)) previous = null
      }
      const last = block.items.at(-1)
      const endImage = last?.node.type.name === 'image' ? imageElement(view, last.pos) : null
      const end = endImage?.getBoundingClientRect() ?? view.coordsAtPos(block.pos + block.node.nodeSize - 1)
      this.marker('¶ 段落结束', '段落结束 · Enter', end.right + 2, end.top + 2, 'is-paragraph')
    }
    const point = caretPoint(view)
    if (point && point.y >= this.clipTop && point.y < innerHeight && point.x >= 0 && point.x <= innerWidth) {
      const caret = document.createElement('span')
      caret.className = 'yy-image-insertion-caret'
      Object.assign(caret.style, { left: `${point.x}px`, top: `${point.y}px`, height: `${point.height}px` })
      this.layer.append(caret)
      view.dom.classList.add('yy-image-caret-active')
    }
    if (state.armed && view.state.selection instanceof NodeSelection) {
      const img = imageElement(view, view.state.selection.from), r = img?.getBoundingClientRect()
      if (r) this.marker('再次按删除键移除图片', '已选中图片；方向键可退出，输入文字会保留图片', r.left, r.bottom + 5, 'is-delete-hint')
    }
  }
  private mousedown = (event: MouseEvent) => {
    const view = this.view
    if (!view.editable || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || view.composing) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('img:not(.ProseMirror-separator), .yy-image-handle, .yy-image-space, button, input')) return
    const state = imageEditingKey.getState(view.state)!
    const block = state.blocks.find(b => {
      const dom = view.nodeDOM(b.pos)
      return dom instanceof HTMLElement && dom.contains(target)
    })
    if (!block) return
    // Do not steal clicks on text immediately next to an image. The closest DOM caret
    // alone is insufficient: in empty row space it may also point into distant text.
    const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (at) {
      const $pos = view.state.doc.resolve(at.pos)
      if ($pos.textOffset || $pos.nodeAfter?.isText || $pos.nodeBefore?.isText) {
        for (const side of [-1, 1]) {
          const dom = view.domAtPos(at.pos, side)
          if (dom.node.nodeType !== Node.TEXT_NODE || dom.node.parentElement?.closest('.yy-image-gap')) continue
          const range = document.createRange()
          range.selectNodeContents(dom.node)
          if ([...range.getClientRects()].some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom)) return
        }
      }
    }
    const edges: { pos: number; edge: Edge; x: number; y: number; bottom: number }[] = []
    for (const item of block.items) {
      if (item.node.type.name !== 'image') continue
      const img = imageElement(view, item.pos)
      if (!img?.getClientRects().length) continue
      const r = img.getBoundingClientRect()
      edges.push({ pos: item.pos, edge: 'before', x: r.left, y: r.top, bottom: r.bottom }, { pos: item.pos + item.node.nodeSize, edge: 'after', x: r.right, y: r.top, bottom: r.bottom })
    }
    const near = edges.filter(e => event.clientY >= e.y - 12 && event.clientY <= e.bottom + 12)
    const distanceY = (edge: typeof edges[number]) => Math.max(edge.y - event.clientY, event.clientY - edge.bottom, 0)
    near.sort((a, b) => Math.abs(a.x - event.clientX) - Math.abs(b.x - event.clientX) || distanceY(a) - distanceY(b))
    const edge = near[0]
    const betweenRows = edges.length && !edges.some(e => event.clientY >= e.y && event.clientY <= e.bottom) && event.clientY > Math.min(...edges.map(e => e.y)) && event.clientY < Math.max(...edges.map(e => e.bottom))
    if (!edge || (Math.abs(edge.x - event.clientX) > 14 && !betweenRows)) return
    event.preventDefault(); event.stopImmediatePropagation()
    const anchor = event.shiftKey ? view.state.selection.anchor : edge.pos
    if (event.shiftKey) view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(edge.pos))))
    else selectEdge(view, edge.pos, edge.edge)
    view.focus()
    this.dragCleanup()
    const move = (e: MouseEvent) => {
      if (Math.abs(e.clientX - event.clientX) + Math.abs(e.clientY - event.clientY) < 4) return
      const at = view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (at) view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(at.pos))))
    }
    const end = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', end)
    this.dragCleanup = end
  }
  destroy() {
    cancelAnimationFrame(this.frame); this.observer.disconnect(); this.dragCleanup()
    window.removeEventListener('scroll', this.schedule, true); window.removeEventListener('resize', this.schedule)
    this.view.dom.removeEventListener('focusin', this.schedule); this.view.dom.removeEventListener('focusout', this.schedule)
    this.view.dom.removeEventListener('mousedown', this.mousedown, true)
    this.view.dom.classList.remove('yy-image-caret-active'); this.layer.remove()
  }
}
