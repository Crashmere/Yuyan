<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, toRaw, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Captions, CopyCheck, Crop, Grid2X2, Scissors, Trash2, Ungroup } from 'lucide-vue-next'
import { clamp, imageDimensions, positive, rect, round, type ImageRect } from '../../schema/imageGeometry'
import { gridLayout, type ImageEditMode } from '../imageOperations'
import ImageSurface from '../ImageSurface.vue'
import ImageCaptionForm from '../ImageCaptionForm.vue'
import type { EditorUi } from '../context'
const props = defineProps(nodeViewProps)
const ui = props.extension.options.ui as EditorUi
const plane = ref<HTMLElement | null>(null)
const picked = reactive(new Set<number>())
const live = ref<Record<string, any>[] | null>(null)
const liveSize = ref<{ width: number; height: number } | null>(null)
const columns = ref(3), gap = ref(12), scale = ref(100)
const attrs = computed<Record<string, any>[]>(() => props.node.content.content.map((n) => ({ ...n.attrs, _marks: n.marks, placement: rect(n.attrs.placement) ?? { x: 0, y: 0, width: 0.25, height: 0.25 } })))
const size = computed(() => liveSize.value ?? { width: positive(props.node.attrs.width, 800), height: positive(props.node.attrs.height, 500) })
const items = computed(() => live.value ?? attrs.value)
const selected = computed(() => [...picked].sort((a, b) => a - b))
const captionIndex = ref<number | null>(null)
watch(() => selected.value.join(','), () => { captionIndex.value = null })
const marquee = ref<ImageRect | null>(null)
const marqueeStyle = computed(() => marquee.value ? cssRect(marquee.value) : {})
let stopDrag: (() => void) | undefined
onBeforeUnmount(() => stopDrag?.())
watch(() => props.selected, (value) => { if (!value) picked.clear() })
watch(() => props.node, () => { for (const i of picked) if (i >= props.node.childCount) picked.delete(i) })
function cssRect(p: ImageRect) { return { left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.width * 100}%`, height: `${p.height * 100}%` } }
function placement(i: number): ImageRect { return rect(items.value[i].placement) ?? { x: 0, y: 0, width: 0.25, height: 0.25 } }
function position() { const pos = props.getPos(); return typeof pos === 'number' ? pos : null }
function activate() {
  const pos = position(); if (pos === null) return
  if (!(props.editor.state.selection instanceof NodeSelection) || props.editor.state.selection.from !== pos) props.editor.view.dispatch(props.editor.state.tr.setSelection(NodeSelection.create(props.editor.state.doc, pos)))
}
function commit(next = attrs.value, board = props.node.attrs) {
  const pos = position(); if (pos === null || !props.editor.isEditable) return
  const e = toRaw(props.editor), current = e.state.doc.nodeAt(pos)
  if (current?.type.name !== 'imageBoard') return
  const nodes = next.map(({ _marks, ...a }) => e.schema.nodes.image.create(a, undefined, _marks?.map((m: any) => toRaw(m))))
  const replacement = e.schema.nodes.imageBoard.create(board, nodes)
  if (replacement.eq(current)) return
  const tr = closeHistory(e.state.tr.replaceWith(pos, pos + current.nodeSize, replacement))
  // Never accept a fitted replacement that discarded a board or its images.
  if (!tr.doc.nodeAt(pos)?.eq(replacement)) return
  tr.setSelection(NodeSelection.create(tr.doc, pos)); props.editor.view.dispatch(tr); props.editor.view.dispatch(closeHistory(props.editor.state.tr))
}
function edit(mode: ImageEditMode) {
  const pos = position(); if (pos === null) return
  let offset = pos + 1
  const positions: number[] = []
  props.node.forEach((n, _, index) => { if (picked.has(index)) positions.push(offset); offset += n.nodeSize })
  ui.openImageTools(mode, positions)
}
function saveCaption(value: string | null) {
  const index = captionIndex.value
  captionIndex.value = null
  if (index !== null) commit(attrs.value.map((a, i) => i === index ? { ...a, caption: value } : a))
  plane.value?.focus()
}
function track(e: PointerEvent, move: (event: PointerEvent) => void, finish: (cancel: boolean) => void) {
  stopDrag?.(); const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const end = (event: PointerEvent) => { const cancel = event.type === 'pointercancel'; stopDrag?.(); finish(cancel) }
  stopDrag = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); stopDrag = undefined }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
}
function drag(e: PointerEvent, index: number, resize = false) {
  if (!props.editor.isEditable || e.button !== 0) return
  e.preventDefault(); e.stopPropagation(); activate(); plane.value?.focus()
  if (!resize && (e.shiftKey || e.metaKey || e.ctrlKey)) { if (picked.has(index)) picked.delete(index); else picked.add(index); return }
  if (!picked.has(index)) { picked.clear(); picked.add(index) }
  const initial = attrs.value.map((a) => ({ ...a })), bounds = plane.value!.getBoundingClientRect(), x = e.clientX, y = e.clientY
  const indices = selected.value, boxes = indices.map((i) => rect(initial[i].placement)!)
  const minX = Math.min(...boxes.map((p) => p.x)), minY = Math.min(...boxes.map((p) => p.y)), maxX = Math.max(...boxes.map((p) => p.x + p.width)), maxY = Math.max(...boxes.map((p) => p.y + p.height))
  let changed = false
  track(e, (ev) => {
    const dx = (ev.clientX - x) / bounds.width, dy = (ev.clientY - y) / bounds.height
    if (!changed && Math.hypot(ev.clientX - x, ev.clientY - y) < 3) return
    changed = true
    let factor = Math.max(0.05, 1 + dx / Math.max(0.01, maxX - minX))
    factor = Math.min(factor, (1 - minX) / (maxX - minX), (1 - minY) / (maxY - minY))
    const tx = clamp(dx, -minX, Math.max(-minX, 1 - maxX)), ty = clamp(dy, -minY, Math.max(-minY, 1 - maxY))
    live.value = initial.map((a, i) => {
      if (!indices.includes(i)) return a
      const p = rect(a.placement)!
      const placement = resize ? { x: round(minX + (p.x - minX) * factor), y: round(minY + (p.y - minY) * factor), width: round(p.width * factor), height: round(p.height * factor) } : { ...p, x: round(p.x + tx), y: round(p.y + ty) }
      return { ...a, placement, ...(resize ? { width: round(placement.width * size.value.width), height: round(placement.height * size.value.height) } : {}) }
    })
  }, (cancel) => { const next = live.value; live.value = null; if (!cancel && changed && next) commit(next) })
}
function beginMarquee(e: PointerEvent) {
  if (!props.editor.isEditable || e.button !== 0) return
  e.preventDefault(); activate(); plane.value?.focus()
  const bounds = plane.value!.getBoundingClientRect(), x = clamp((e.clientX - bounds.left) / bounds.width, 0, 1), y = clamp((e.clientY - bounds.top) / bounds.height, 0, 1)
  const keep = e.shiftKey ? [...picked] : []; picked.clear(); keep.forEach((i) => picked.add(i))
  track(e, (ev) => {
    const tx = clamp((ev.clientX - bounds.left) / bounds.width, 0, 1), ty = clamp((ev.clientY - bounds.top) / bounds.height, 0, 1)
    marquee.value = { x: Math.min(x, tx), y: Math.min(y, ty), width: Math.abs(tx - x), height: Math.abs(ty - y) }
    picked.clear(); keep.forEach((i) => picked.add(i))
    items.value.forEach((_, i) => { const p = placement(i), m = marquee.value!; if (p.x < m.x + m.width && p.x + p.width > m.x && p.y < m.y + m.height && p.y + p.height > m.y) picked.add(i) })
  }, () => { marquee.value = null })
}
function sized(nextWidth: number, nextHeight: number, scaleContents = false) {
  const oldWidth = positive(props.node.attrs.width, 800), oldHeight = positive(props.node.attrs.height, 500)
  const width = round(clamp(nextWidth, 48, 4000)), height = round(clamp(nextHeight, 48, 8000))
  const next = attrs.value.map((a) => {
    const p = rect(a.placement)!
    return { ...a, placement: scaleContents ? p : { x: round(p.x * oldWidth / width), y: round(p.y * oldHeight / height), width: round(p.width * oldWidth / width), height: round(p.height * oldHeight / height) },
      ...(scaleContents ? { width: round(p.width * width), height: round(p.height * height) } : {}) }
  })
  return { next, board: { ...props.node.attrs, width, height } }
}
function setSize(key: 'width' | 'height', value: string) {
  const n = Number(value); if (!Number.isFinite(n) || n <= 0) return
  const r = sized(key === 'width' ? n : size.value.width, key === 'height' ? n : size.value.height)
  commit(r.next, r.board)
}
function resizeBoard(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault(); e.stopPropagation(); activate()
  const initial = size.value, bounds = plane.value!.getBoundingClientRect(), ratio = initial.width / bounds.width, x = e.clientX, y = e.clientY
  track(e, (ev) => { const r = sized(initial.width + (ev.clientX - x) * ratio, initial.height + (ev.clientY - y) * ratio); liveSize.value = { width: r.board.width, height: r.board.height }; live.value = r.next }, (cancel) => {
    const next = live.value, board = liveSize.value; live.value = null; liveSize.value = null
    if (!cancel && next && board) commit(next, { ...props.node.attrs, ...board })
  })
}
function scaleBoard() {
  const { width, height } = size.value
  const factor = clamp(clamp(Number(scale.value) || 100, 10, 400) / 100, Math.max(48 / width, 48 / height), Math.min(4000 / width, 8000 / height))
  const r = sized(width * factor, height * factor, true); commit(r.next, r.board); scale.value = 100
}
function resizePicked(factor: number) {
  commit(attrs.value.map((a, i) => { const p = rect(a.placement)!; if (!picked.has(i)) return a
    const f = Math.min(factor, Math.max(0.05, (1 - p.x) / p.width), Math.max(0.05, (1 - p.y) / p.height))
    return { ...a, placement: { ...p, width: round(p.width * f), height: round(p.height * f) }, width: round(p.width * size.value.width * f), height: round(p.height * size.value.height * f) }
  }))
}
function grid() {
  const indices = selected.value.length ? selected.value : attrs.value.map((_, i) => i)
  const width = size.value.width, oldHeight = size.value.height
  const layout = gridLayout(indices.map((i) => attrs.value[i]), width, columns.value, gap.value)
  const height = indices.length === attrs.value.length ? round(layout.height) : Math.max(oldHeight, round(layout.height))
  const next = attrs.value.map((a, i) => {
    const index = indices.indexOf(i), p = rect(a.placement)!
    if (index < 0) return { ...a, placement: { ...p, y: round(p.y * oldHeight / height), height: round(p.height * oldHeight / height) } }
    const placed = layout.attrs[index], q = rect(placed.placement)!
    return { ...placed, placement: { ...q, y: round(q.y * layout.height / height), height: round(q.height * layout.height / height) } }
  })
  commit(next, { ...props.node.attrs, height })
}
function distribute(axis: 'x' | 'y') {
  const dimension = axis === 'x' ? 'width' : 'height'
  const indices = selected.value.sort((a, b) => placement(a)[axis] - placement(b)[axis])
  if (indices.length < 3) return
  const start = placement(indices[0])[axis], end = Math.max(...indices.map((i) => placement(i)[axis] + placement(i)[dimension]))
  const spacing = (end - start - indices.reduce((sum, i) => sum + placement(i)[dimension], 0)) / (indices.length - 1)
  const next = attrs.value.map((a) => ({ ...a })); let offset = start
  for (const i of indices) { const p = placement(i); next[i].placement = { ...p, [axis]: round(offset) }; offset += p[dimension] + spacing }
  commit(next)
}
function remove() {
  if (!picked.size) return
  if (picked.size === attrs.value.length) { props.deleteNode(); return }
  const next = attrs.value.filter((_, i) => !picked.has(i)); picked.clear(); commit(next)
}
function layer(front: boolean) {
  const selected = attrs.value.filter((_, i) => picked.has(i)), rest = attrs.value.filter((_, i) => !picked.has(i))
  if (!selected.length) return
  picked.clear()
  const next = front ? [...rest, ...selected] : [...selected, ...rest]
  selected.forEach((_, i) => picked.add(front ? rest.length + i : i))
  commit(next)
}
function ungroup() {
  const pos = position(); if (pos === null) return
  const e = toRaw(props.editor), current = e.state.doc.nodeAt(pos)
  if (current?.type.name !== 'imageBoard') return
  const nodes = attrs.value.map(({ _marks, ...a }, i) => { const p = rect(a.placement)!; const image = e.schema.nodes.image.create({ ...a, placement: null, width: round(p.width * size.value.width), height: round(p.height * size.value.height), blockAlign: null }, undefined, current.child(i).marks); return e.schema.nodes.paragraph.create(null, image) })
  const tr = closeHistory(e.state.tr.replaceWith(pos, pos + current.nodeSize, nodes)); tr.setSelection(NodeSelection.create(tr.doc, pos + 1)); e.view.dispatch(tr); e.view.dispatch(closeHistory(e.state.tr))
}
function keyboard(e: KeyboardEvent) {
  if (e.isComposing || (e.target instanceof Element && e.target.closest('input, textarea, select, button'))) return
  const handled = () => { e.preventDefault(); e.stopPropagation() }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { handled(); props.editor.commands.selectAll(); props.editor.view.focus(); return }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { handled(); e.shiftKey ? props.editor.commands.redo() : props.editor.commands.undo(); return }
  if (e.key === 'Escape' && picked.size) { handled(); picked.clear(); return }
  if ((e.key === 'Backspace' || e.key === 'Delete') && picked.size) { handled(); remove(); return }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && picked.size) {
    handled(); const amount = e.shiftKey ? 10 : 1, dx = (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0) / size.value.width, dy = (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0) / size.value.height
    commit(attrs.value.map((a, i) => { const p = rect(a.placement)!; return picked.has(i) ? { ...a, placement: { ...p, x: round(clamp(p.x + dx, 0, Math.max(0, 1 - p.width))), y: round(clamp(p.y + dy, 0, Math.max(0, 1 - p.height))) } } : a }))
  }
}
</script>
<template>
  <node-view-wrapper class="yy-board-view" :class="{ selected: props.selected }" contenteditable="false" @keydown="keyboard">
    <div v-if="props.selected && editor.isEditable" class="yy-board-toolbar" @mousedown.stop>
      <div class="yy-board-row">
        <strong>图片组合</strong>
        <label>宽 <input type="number" :value="size.width" min="48" max="4000" aria-label="画板宽度" @change="setSize('width', ($event.target as HTMLInputElement).value)" /></label>
        <label>高 <input type="number" :value="size.height" min="48" max="8000" aria-label="画板高度" @change="setSize('height', ($event.target as HTMLInputElement).value)" /></label>
        <select :value="node.attrs.blockAlign ?? 'left'" aria-label="画板对齐" @change="commit(attrs, { ...node.attrs, blockAlign: ($event.target as HTMLSelectElement).value })"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select>
        <label>整体 <input v-model.number="scale" type="number" min="10" max="400" aria-label="整体缩放比例" />%</label><button type="button" @click="scaleBoard">缩放</button>
        <button type="button" data-tip="解除组合，恢复为独立图片" aria-label="解除图片组合" @click="ungroup"><Ungroup :size="15" /></button>
      </div>
      <div class="yy-board-row">
        <span>已选 {{ picked.size }} / {{ items.length }}</span><button type="button" @click="items.forEach((_, i) => picked.add(i))">全选</button>
        <button type="button" :disabled="!picked.size" @click="resizePicked(0.9)">缩小</button><button type="button" :disabled="!picked.size" @click="resizePicked(1.1)">放大</button>
        <button type="button" :disabled="!picked.size" @click="layer(true)">置顶</button><button type="button" :disabled="!picked.size" @click="layer(false)">置底</button>
        <button type="button" :disabled="!picked.size" data-tip="裁切所选图片" aria-label="裁切组合内图片" @click="edit('crop')"><Crop :size="15" /></button>
        <button type="button" :disabled="picked.size !== 1" data-tip="切分所选图片" aria-label="切分组合内图片" @click="edit('split')"><Scissors :size="15" /></button>
        <button type="button" :disabled="picked.size !== 1" data-tip="图片说明" aria-label="组合内图片说明" @click="captionIndex = selected[0]"><Captions :size="15" /></button>
        <button type="button" :disabled="!picked.size" data-tip="批量应用图片参数" aria-label="批量应用组合内图片参数" @click="edit('apply')"><CopyCheck :size="15" /></button>
        <span class="yy-bubble-sep"></span><label>列 <input v-model.number="columns" type="number" min="1" :max="items.length" aria-label="排列列数" /></label><label>间距 <input v-model.number="gap" type="number" min="0" max="100" aria-label="排列间距" /></label>
        <button type="button" data-tip="按网格均匀排列所选图片，未选时排列全部" aria-label="网格排列" @click="grid"><Grid2X2 :size="15" /></button>
        <button type="button" :disabled="picked.size < 3" data-tip="水平等距分布" aria-label="水平等距分布" @click="distribute('x')"><AlignHorizontalSpaceAround :size="15" /></button>
        <button type="button" :disabled="picked.size < 3" data-tip="垂直等距分布" aria-label="垂直等距分布" @click="distribute('y')"><AlignVerticalSpaceAround :size="15" /></button>
        <button type="button" :disabled="!picked.size" data-tip="移除所选图片" aria-label="移除组合内图片" @click="remove"><Trash2 :size="15" /></button>
      </div>
      <ImageCaptionForm v-if="captionIndex !== null" :value="attrs[captionIndex]?.caption" @save="saveCaption" @cancel="captionIndex = null; plane?.focus()" />
    </div>
    <div class="yy-board-frame" :style="{ width: `${size.width}px`, marginLeft: node.attrs.blockAlign === 'center' || node.attrs.blockAlign === 'right' ? 'auto' : '0', marginRight: node.attrs.blockAlign === 'right' ? '0' : 'auto' }">
      <div ref="plane" data-board-plane class="yy-board-plane" tabindex="0" aria-label="图片画板，点击选择图片，Shift 多选，拖动空白框选" :style="{ aspectRatio: `${size.width} / ${size.height}` }" @pointerdown.self="beginMarquee" @dragstart.prevent>
        <div v-for="(a, i) in items" :key="i" class="yy-board-item" :class="{ picked: picked.has(i) && props.selected }" :style="cssRect(placement(i))" :data-board-index="i" @pointerdown="drag($event, i)">
          <ImageSurface :attrs="{ ...a, placement: null, width: placement(i).width * size.width, height: placement(i).height * size.height }" />
          <span v-if="a.caption" class="yy-image-caption">{{ a.caption }}</span>
          <span v-if="picked.has(i) && props.selected" class="yy-board-item-handle" @pointerdown.stop="drag($event, i, true)"></span>
        </div>
        <span v-if="marquee" class="yy-board-marquee" :style="marqueeStyle"></span>
      </div>
      <span v-if="props.selected && editor.isEditable" class="yy-board-resize" data-tip="调整画板尺寸，内部图片保持大小" @pointerdown="resizeBoard"></span>
    </div>
    <div v-if="props.selected && editor.isEditable" class="yy-board-hint">拖动图片自由排列 · Shift 多选 · 拖动空白框选 · 方向键微调（Shift 为 10 px）</div>
  </node-view-wrapper>
</template>
