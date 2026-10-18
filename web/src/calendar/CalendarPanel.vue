<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CalendarDays, Check, ChevronRight, ChevronDown,
  Plus, Save, Trash2, X, Maximize2, Minimize2, Copy, ClipboardPaste, ListFilter, Search,
} from 'lucide-vue-next'
import { errorMessage } from '../shared/api'
import { confirm, prompt } from '../ui/dialog'
import { copyText } from '../shared/clipboard'
import { decodeCalendar, encodeCalendar } from './transfer'
import IconButton from '../ui/IconButton.vue'
import DateRangeField from './DateRangeField.vue'
import { toast } from '../ui/toast'
import { searchTerms } from '../shared/searchMatch'
import {
  addDays, addUnits, adjustPeriod, assignPeriodLanes, canonicalRange, dateAtPosition, dayPosition,
  parseCalendarDate, periodDays, periodGeometry, periodRangeLabel, todayDate, unitBounds, windowCells,
} from './dates'
import type { CalendarData, CalendarEntry, CalendarPrecision } from '../schema/calendar'

const props = defineProps<{ model: CalendarData; readonly?: boolean }>()
const emit = defineEmits<{ change: [value: CalendarData]; undo: [redo: boolean] }>()
const root = ref<HTMLElement | null>(null)
const inspector = ref<HTMLElement | null>(null)
const expanded = ref(false)
const collapsed = ref(!!props.model.collapsed)
const titleInput = ref<HTMLInputElement | null>(null)
let collapsedAnchor = props.model.center || todayDate()
async function toggleCollapsed() {
  if (dragging.value) return
  if (!collapsed.value) collapsedAnchor = viewportDate()
  collapsed.value = !collapsed.value
  publish()
  if (!collapsed.value) await centerTimeline(collapsedAnchor)
}
let relocating = false
async function toggleExpanded(event?: MouseEvent) {
  const anchor = viewportDate()
  collapsed.value = false
  relocating = true
  const focused = event?.currentTarget as HTMLElement | undefined
    ?? (root.value?.contains(document.activeElement) ? document.activeElement as HTMLElement : root.value)
  expanded.value = !expanded.value
  await nextTick()
  // Let the new container finish layout before restoring its horizontal position.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  if (disposed) return
  await centerTimeline(anchor)
  relocating = false
  // Teleport moves the focused control out of its parent; restore focus after the move.
  if (!disposed) focused?.focus({ preventScroll: true })
}
const calendarTitle = ref(props.model.title)
function calendarData(): CalendarData {
  return { version: 1, title: calendarTitle.value, grain: grain.value, center: center.value, collapsed: collapsed.value,
    periods: periods.value.map(period => ({ ...period })) }
}
function publish() {
  if (props.readonly) return
  emit('change', calendarData())
}
function renameCalendar() {
  calendarTitle.value = [...calendarTitle.value.trim()].slice(0, 120).join('') || '日历'
  if (calendarTitle.value !== props.model.title) publish()
}
const transferring = ref(false)
let disposed = false
async function copyCalendar() {
  if (transferring.value) return
  transferring.value = true
  try {
    const data = calendarData()
    if (draftDirty.value && draft.value && !props.readonly) {
      if (rangeError.value) { await flush(); return }
      const value = draft.value
      const period = { ...draftPayload(value), title: value.title.trim(), note: value.note.trim(), id: value.id ?? Math.max(0, ...data.periods.map(p => p.id)) + 1 }
      const index = data.periods.findIndex(p => p.id === period.id)
      if (index < 0) data.periods.push(period)
      else data.periods[index] = period
    }
    const text = encodeCalendar(data)
    const copied = await copyText(text)
    if (disposed) return
    if (copied) toast('日历已复制，可在另一个日历中导入', 'success')
    else await prompt({ title: '未能自动复制，请手动复制以下内容', value: text, multiline: true, confirmText: '完成' })
  } catch (error) { if (!disposed) toast(errorMessage(error), 'error') }
  finally { transferring.value = false }
}
async function importCalendar() {
  if (transferring.value || props.readonly) return
  transferring.value = true
  let text = '', reason = ''
  try {
    // Read during the click gesture, before opening any lazy dialog or awaiting a save.
    try { text = await navigator.clipboard.readText() }
    catch { reason = '浏览器未能读取剪贴板，请在下方粘贴日历字符串' }
    while (!disposed) {
      if (reason) {
        const value = await prompt({ title: '导入日历', label: reason, value: text, placeholder: '粘贴 YYCAL1: 开头的完整字符串', multiline: true, confirmText: '导入' })
        if (value === null || disposed) return
        text = value
      }
      let data: CalendarData
      try { data = decodeCalendar(text) }
      catch (error) { reason = errorMessage(error); continue }
      // Preserve a valid pending edit as the state restored by document undo.
      if (!await flush() || disposed) return
      calendarTitle.value = data.title
      grain.value = data.grain
      center.value = data.center || todayDate()
      collapsed.value = !!data.collapsed
      periods.value = data.periods.map(p => ({ ...p }))
      draft.value = null
      emit('change', data)
      await centerTimeline()
      if (!disposed) toast(`已导入 ${data.periods.length} 个事件，可撤销恢复原日历`, 'success')
      return
    }
  } finally { transferring.value = false }
}
function syncModel() {
  calendarTitle.value = props.model.title
  grain.value = props.model.grain
  center.value = props.model.center || todayDate()
  collapsed.value = !!props.model.collapsed
  periods.value = props.model.periods.map(p => ({ ...p }))
}
watch(() => props.model, () => {
  const previous = JSON.stringify(periods.value)
  syncModel()
  // Undo or external document updates replace the event draft as well.
  if (previous !== JSON.stringify(props.model.periods)) draft.value = null
})

const grains: { value: CalendarPrecision; label: string }[] = [
  { value: 'year', label: '年' },
  { value: 'month', label: '月' },
  { value: 'day', label: '日' },
]
const colors = [
  { value: 'emerald', label: '松石绿' },
  { value: 'blue', label: '湖蓝' },
  { value: 'violet', label: '鸢尾紫' },
  { value: 'amber', label: '琥珀' },
  { value: 'rose', label: '蔷薇' },
  { value: 'cyan', label: '青色' },
  { value: 'slate', label: '岩灰' },
  { value: 'lime', label: '青柠' },
]

const grain = ref<CalendarPrecision>(props.model.grain)
const center = ref(props.model.center || todayDate())
const axisCenter = ref(center.value)
const periods = ref<CalendarEntry[]>(props.model.periods.map(p => ({ ...p })))
const timelineScroll = ref<HTMLElement | null>(null)
const timeline = ref<HTMLElement | null>(null)
const scrollLeft = ref(0)
const viewportWidth = ref(0)
const axisWidth = ref(0)
const showList = ref(false)
const listQuery = ref('')
const showValidation = ref(false)
const dateInputError = ref('')
const today = todayDate()
const dragging = ref(false)
const gestureLanes = ref<ReturnType<typeof assignPeriodLanes> | null>(null)

interface Draft extends Omit<CalendarEntry, 'id'> {
  id: number | null
}
const draft = ref<Draft | null>(null)
const draftBaseline = ref('')

const unitWidth = computed(() => grain.value === 'year' ? 88 : grain.value === 'month' ? 80 : 48)
const cells = computed(() => windowCells(axisCenter.value, grain.value, 192))
const cellWidth = computed(() => axisWidth.value / cells.value.length || unitWidth.value)
const visibleStart = computed(() => dateAtPosition(scrollLeft.value / cellWidth.value, cells.value))
const visibleEnd = computed(() => dateAtPosition((scrollLeft.value + viewportWidth.value - 1) / cellWidth.value, cells.value))
const windowLabel = computed(() => periodRangeLabel({ startDate: visibleStart.value, endDate: visibleEnd.value, precision: grain.value }))
const timelineMinWidth = computed(() => cells.value.length * unitWidth.value)
const todayGeometry = computed(() => periodGeometry({ startDate: today, endDate: today }, cells.value))
const listPeriods = computed(() => {
  const terms = searchTerms(listQuery.value)
  return [...renderedPeriods.value].filter(p => terms.every(term => `${p.title}\n${p.note}\n${p.startDate}\n${p.endDate}\n${periodRangeLabel(p)}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id - b.id)
})
function periodStatus(period: Pick<CalendarEntry, 'startDate' | 'endDate'>) {
  return period.startDate > today ? '未开始' : period.endDate < today ? '已结束' : '进行中'
}
const currentCount = computed(() => periods.value.filter(p => p.startDate <= today && p.endDate >= today).length)

function draftAsPeriod(): CalendarEntry | null {
  if (!draft.value) return null
  return {
    ...draft.value,
    id: draft.value.id ?? -1,
  }
}

const renderedPeriods = computed(() => {
  // Form edits never affect the calendar. Only an active bar gesture has a live preview.
  if (!dragging.value) return periods.value
  const preview = draftAsPeriod()
  if (!preview) return periods.value
  if (preview.id === -1) return [...periods.value, preview]
  return periods.value.map((period) => period.id === preview.id ? preview : period)
})
const laneLayout = computed(() => gestureLanes.value ?? assignPeriodLanes(renderedPeriods.value))
const visiblePeriods = computed(() => renderedPeriods.value.flatMap((period) => {
  const geometry = periodGeometry(period, cells.value)
  return geometry ? [{ period, geometry, lane: laneLayout.value.lanes.get(period.id) ?? 0 }] : []
}))
const laneCount = computed(() => Math.max(0, ...visiblePeriods.value.map(p => p.lane + 1)))
const timelineHeight = computed(() => Math.max(164, 58 + laneCount.value * 48 + 14))
const selectedID = computed(() => dragging.value ? draft.value?.id ?? null : null)
const inspectorOpen = computed(() => !!draft.value && !dragging.value)
watch(inspectorOpen, async (open) => {
  await nextTick()
  if (disposed) return
  if (open) focusInspector()
  else if (!dragging.value) root.value?.focus({ preventScroll: true })
})
function focusInspector() {
  const first = inspector.value?.querySelector<HTMLInputElement>('[name="calendar-title"]') ?? inspector.value
  first?.focus({ preventScroll: true })
}
function containInspectorScroll(event: WheelEvent | TouchEvent) {
  if (!(event.target as Element).closest('.yy-calendar-inspector-body')) event.preventDefault()
}
const draftDirty = computed(() => !!draft.value && JSON.stringify(draftPayload(draft.value)) !== draftBaseline.value)
const rangeError = computed(() => {
  const value = draft.value
  if (!value) return ''
  if (dateInputError.value) return dateInputError.value
  if (value.id == null && periods.value.length >= 2000) return '单个日历最多保存 2,000 个事件'
  if (!value.title.trim()) return '请填写事件名称'
  if ([...value.title.trim()].length > 120) return '事件名称不能超过 120 个字符'
  if ([...value.note].length > 2000) return '标注不能超过 2,000 个字符'
  try {
    parseCalendarDate(value.startDate)
    parseCalendarDate(value.endDate)
  } catch {
    return '请选择有效的起始和结束时间'
  }
  if (value.startDate > value.endDate) return '结束时间不能早于起始时间'
  return ''
})

function draftPayload(value: Draft): Omit<CalendarEntry, 'id'> {
  return {
    title: value.title,
    note: value.note,
    startDate: value.startDate,
    endDate: value.endDate,
    precision: value.precision,
    color: value.color,
  }
}

function openPeriod(period: CalendarEntry) {
  showValidation.value = false
  const value: Draft = {
    id: period.id,
    title: period.title,
    note: period.note,
    startDate: period.startDate,
    endDate: period.endDate,
    precision: period.precision,
    color: period.color,
  }
  draft.value = value
  draftBaseline.value = JSON.stringify(draftPayload(value))
}

function openNew(start: string, end: string, precision = grain.value) {
  showValidation.value = false
  const range = canonicalRange(start, end, precision)
  const value: Draft = {
    id: null,
    title: '',
    note: '',
    ...range,
    precision,
    color: 'emerald',
  }
  draft.value = value
  draftBaseline.value = JSON.stringify(draftPayload(value))
  void nextTick(focusInspector)
}

async function newAtCenter() {
  if (props.readonly) return
  if (periods.value.length >= 2000) { toast('单个日历最多保存 2,000 个事件', 'info'); return }
  if (!await flush() || disposed) return
  const anchor = collapsed.value ? collapsedAnchor : viewportDate()
  const range = unitBounds(anchor, grain.value)
  openNew(range.start, range.end)
}

async function closeDraft(force = false) {
  if (!draft.value) return
  if (!force && (draftDirty.value || dateInputError.value)) {
    const ok = await confirm({ title: '放弃未保存的修改？', message: '时间、名称或标注的修改还没有保存。', confirmText: '放弃修改', danger: true })
    if (!ok) { focusInspector(); return }
  }
  draft.value = null
}

function saveDraft(notify = true) {
  const value = draft.value
  if (!value || props.readonly) return
  if (rangeError.value) {
    showValidation.value = true
    toast(rangeError.value, 'error')
    return
  }
  if (value.id != null && !draftDirty.value) { draft.value = null; return }
  const saved: CalendarEntry = {
    ...draftPayload(value), title: value.title.trim(), note: value.note.trim(),
    id: value.id ?? Math.max(0, ...periods.value.map(p => p.id)) + 1,
  }
  const index = periods.value.findIndex(period => period.id === saved.id)
  if (index >= 0) periods.value.splice(index, 1, saved)
  else periods.value.push(saved)
  periods.value.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id - b.id)
  draft.value = null
  publish()
  if (notify) toast('事件已应用到文档', 'success', { key: 'calendar-applied' })
}

async function selectPeriod(period: CalendarEntry) {
  if (draft.value?.id !== period.id && !await flush()) return
  if (disposed) return
  if (draft.value?.id !== period.id) openPeriod(period)
}

async function locateEvent(period: CalendarEntry) {
  const days = periodDays(period)
  grain.value = days <= 42 ? 'day' : days <= 730 ? 'month' : 'year'
  center.value = addDays(period.startDate, Math.floor((days - 1) / 2))
  publish()
  await centerTimeline()
}

function duplicateDraft() {
  if (!draft.value) return
  if (periods.value.length >= 2000) { toast('单个日历最多保存 2,000 个事件', 'info'); return }
  if (rangeError.value) { showValidation.value = true; toast(rangeError.value, 'error'); return }
  const value = { ...draft.value }
  openNew(value.startDate, value.endDate, value.precision)
  Object.assign(draft.value!, { title: `${[...value.title].slice(0, 116).join('')}（副本）`, note: value.note, color: value.color })
}

function setDuration(amount: number) {
  if (!draft.value) return
  const last = addUnits(draft.value.startDate, draft.value.precision, amount - 1)
  if (last.length === 10 && last <= '9999-12-31') draft.value.endDate = unitBounds(last, draft.value.precision).end
}

async function removeDraft() {
  const value = draft.value
  if (!value || value.id == null || props.readonly) return
  const ok = await confirm({ title: `删除“${value.title}”？`, message: '这个时间段和标注会从文档日历移除，可以通过文档撤销恢复。', confirmText: '删除', danger: true })
  if (!ok || disposed) return
  periods.value = periods.value.filter(period => period.id !== value.id)
  await closeDraft(true)
  publish()
  toast('事件已删除', 'success')
}

function changeDraftDates(value: { startDate: string; endDate: string; precision: CalendarPrecision }) {
  if (draft.value) Object.assign(draft.value, value)
}

function syncViewport() {
  const element = timelineScroll.value
  if (!element) return
  scrollLeft.value = element.scrollLeft
  viewportWidth.value = element.clientWidth
  axisWidth.value = timeline.value?.offsetWidth ?? 0
}

let rebasing = false
async function scrollTimeline() {
  syncViewport()
  const element = timelineScroll.value
  if (!element || rebasing || relocating) return
  if (barGesture?.moved) updateBar(edgeX)
  if (createGesture) updateCreate(edgeX)
  const buffer = Math.max(viewportWidth.value * 2, unitWidth.value * 48)
  const left = element.scrollLeft < buffer && cells.value[0].start > '1000-01-01'
  const right = element.scrollWidth - element.clientWidth - element.scrollLeft < buffer && cells.value.at(-1)!.end < '9999-12-31'
  if (!left && !right) return
  rebasing = true
  const oldScroll = element.scrollLeft
  const oldCells = cells.value
  const oldStart = oldCells[0].start
  axisCenter.value = viewportDate()
  const newStart = cells.value[0].start
  const units = newStart >= oldStart ? dayPosition(newStart, oldCells) : -dayPosition(oldStart, cells.value)
  const offset = units * unitWidth.value
  await nextTick()
  if (disposed) return
  // Recycle offscreen cells while keeping every visible date at the same pixel.
  element.scrollLeft = oldScroll - offset
  if (barGesture) barGesture.startScroll -= offset
  syncViewport()
  rebasing = false
}

function wheelTimeline(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const element = timelineScroll.value
  if (!element) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  event.preventDefault()
  const amount = delta * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? element.clientWidth : 1)
  element.scrollLeft += amount
  void scrollTimeline()
}

function viewportDate(sync = true) {
  if (sync) syncViewport()
  return axisWidth.value && viewportWidth.value ? dateAtPosition((scrollLeft.value + viewportWidth.value / 2) / cellWidth.value, cells.value) : center.value
}

function dateOffset(date: string) {
  const bounds = unitBounds(date, grain.value)
  return (dayPosition(date, cells.value) + .5 / periodDays({ startDate: bounds.start, endDate: bounds.end })) * cellWidth.value
}

function setGrain(value: CalendarPrecision, date = viewportDate()) {
  if (dragging.value) return
  center.value = date
  grain.value = value
  publish()
  void centerTimeline()
}

function drillCell(date: string) {
  setGrain(grain.value === 'year' ? 'month' : 'day', date)
}

async function centerTimeline(date = center.value) {
  axisCenter.value = date
  await nextTick()
  const element = timelineScroll.value
  if (element) {
    syncViewport()
    const offset = dateOffset(date)
    element.scrollLeft = Math.max(0, offset - element.clientWidth / 2)
    syncViewport()
  }
}

watch(grain, () => void centerTimeline())
watch(center, () => void centerTimeline())

interface CreateGesture {
  pointerId: number
  startDate: string
}
let createGesture: CreateGesture | null = null
const creatingRange = ref<{ start: string; end: string } | null>(null)
const creatingGeometry = computed(() => creatingRange.value ? periodGeometry({ startDate: creatingRange.value.start, endDate: creatingRange.value.end }, cells.value) : null)

function cellIndex(clientX: number): number {
  const element = timeline.value
  if (!element) return 0
  const rect = element.getBoundingClientRect()
  return Math.max(0, Math.min(cells.value.length - 1, Math.floor((clientX - rect.left) / rect.width * cells.value.length)))
}

function beginCreate(event: PointerEvent) {
  if (props.readonly || event.button !== 0 || event.pointerType === 'touch' || !timeline.value) return
  if ((event.target as HTMLElement).closest('button')) return
  if (draftDirty.value) {
    toast('请先保存或取消当前修改', 'info')
    return
  }
  const index = cellIndex(event.clientX)
  createGesture = { pointerId: event.pointerId, startDate: cells.value[index].start }
  dragging.value = true
  creatingRange.value = { start: cells.value[index].start, end: cells.value[index].end }
  root.value?.focus({ preventScroll: true })
  timeline.value.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function moveCreate(event: PointerEvent) {
  if (!createGesture || event.pointerId !== createGesture.pointerId) return
  edgeScroll(event.clientX)
  updateCreate(event.clientX)
}

function endCreate(event: PointerEvent) {
  if (!createGesture || event.pointerId !== createGesture.pointerId) return
  const range = creatingRange.value
  createGesture = null
  creatingRange.value = null
  stopEdgeScroll()
  dragging.value = false
  if (range && event.type === 'pointerup') openNew(range.start, range.end)
}

type BarMode = 'move' | 'start' | 'end'
interface BarGesture {
  pointerId: number
  startX: number
  period: CalendarEntry
  mode: BarMode
  moved: boolean
  target: HTMLElement
  draftBefore: Draft | null
  baselineBefore: string
  startScroll: number
}
let barGesture: BarGesture | null = null
let edgeFrame = 0
let edgeX = 0
function stopEdgeScroll() {
  cancelAnimationFrame(edgeFrame)
  edgeFrame = 0
}
function edgeScroll(clientX: number) {
  edgeX = clientX
  if (edgeFrame) return
  const step = () => {
    edgeFrame = 0
    const element = timelineScroll.value
    if (!element || (!barGesture && !createGesture)) return
    if (rebasing) { edgeFrame = requestAnimationFrame(step); return }
    const rect = element.getBoundingClientRect()
    const speed = edgeX < rect.left + 40 ? -Math.min(14, (rect.left + 40 - edgeX) / 3)
      : edgeX > rect.right - 40 ? Math.min(14, (edgeX - rect.right + 40) / 3) : 0
    if (!speed) return
    const before = element.scrollLeft
    element.scrollLeft += speed
    if (element.scrollLeft === before) return
    syncViewport()
    if (barGesture) updateBar(edgeX)
    else if (createGesture) updateCreate(edgeX)
    void scrollTimeline()
    edgeFrame = requestAnimationFrame(step)
  }
  edgeFrame = requestAnimationFrame(step)
}

function updateCreate(clientX: number) {
  if (!createGesture) return
  const cell = cells.value[cellIndex(clientX)]
  const range = canonicalRange(createGesture.startDate, cell.start, grain.value)
  creatingRange.value = { start: range.startDate, end: range.endDate }
}

function beginBar(event: PointerEvent, period: CalendarEntry, mode: BarMode) {
  event.stopPropagation()
  if (period.id === -1) return
  if (props.readonly) { void selectPeriod(period); return }
  if (draftDirty.value && draft.value?.id !== period.id) {
    if (rangeError.value) { void flush(); return }
    saveDraft(false)
  }
  if (event.pointerType === 'touch' || event.button !== 0) {
    if (event.pointerType === 'touch' && mode === 'move') void selectPeriod(period)
    return
  }
  const target = event.currentTarget as HTMLElement
  root.value?.focus({ preventScroll: true })
  target.setPointerCapture(event.pointerId)
  barGesture = { pointerId: event.pointerId, startX: event.clientX, period: { ...period }, mode, moved: false, target,
    draftBefore: draft.value ? { ...draft.value } : null, baselineBefore: draftBaseline.value, startScroll: timelineScroll.value?.scrollLeft ?? 0 }
  gestureLanes.value = assignPeriodLanes(renderedPeriods.value)
  target.addEventListener('pointermove', moveBar)
  target.addEventListener('pointerup', endBar)
  target.addEventListener('pointercancel', endBar)
  event.preventDefault()
}

function moveBar(event: PointerEvent) {
  const gesture = barGesture
  if (!gesture || gesture.pointerId !== event.pointerId || !timeline.value) return
  edgeScroll(event.clientX)
  updateBar(event.clientX)
}

function updateBar(clientX: number) {
  const gesture = barGesture
  if (!gesture) return
  const distance = clientX - gesture.startX + (timelineScroll.value?.scrollLeft ?? 0) - gesture.startScroll
  if (!gesture.moved && Math.abs(distance) < 5) return
  gesture.moved = true
  dragging.value = true
  const delta = Math.round(distance / cellWidth.value)
  const adjusted = adjustPeriod(gesture.period, grain.value, delta, gesture.mode)
  if (draft.value?.id !== gesture.period.id) openPeriod(gesture.period)
  if (draft.value) Object.assign(draft.value, { startDate: adjusted.startDate, endDate: adjusted.endDate })
}

function endBar(event: PointerEvent) {
  const gesture = barGesture
  if (!gesture || gesture.pointerId !== event.pointerId) return
  gesture.target.removeEventListener('pointermove', moveBar)
  gesture.target.removeEventListener('pointerup', endBar)
  gesture.target.removeEventListener('pointercancel', endBar)
  stopEdgeScroll()
  barGesture = null
  gestureLanes.value = null
  dragging.value = false
  if (event.type === 'pointercancel') {
    draft.value = gesture.draftBefore
    draftBaseline.value = gesture.baselineBefore
    return
  }
  if (!gesture.moved) {
    if (draft.value?.id !== gesture.period.id) openPeriod(gesture.period)
    return
  }
  if (draftDirty.value) toast('日期已调整，应用后生效', 'info', { key: 'calendar-dates' })
}

function onKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape' && (barGesture || createGesture)) {
    event.preventDefault()
    if (barGesture) endBar(new PointerEvent('pointercancel', { pointerId: barGesture.pointerId }))
    if (createGesture) endCreate(new PointerEvent('pointercancel', { pointerId: createGesture.pointerId }))
    return
  }
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.isComposing && event.key.toLowerCase() === 'z' && !(event.target as HTMLElement).closest('input, textarea')) {
    event.preventDefault()
    emit('undo', event.shiftKey)
    return
  }
  if (event.key === 'Escape' && !draft.value && expanded.value) { void toggleExpanded(); event.preventDefault(); return }
  if (!draft.value || event.defaultPrevented || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeDraft()
  } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void saveDraft()
  }
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  void centerTimeline()
  resizeObserver = new ResizeObserver(() => {
    if (relocating || rebasing || collapsed.value) return
    if (dragging.value) { syncViewport(); return }
    const anchor = viewportDate(false)
    syncViewport()
    const element = timelineScroll.value
    if (element) element.scrollLeft = dateOffset(anchor) - viewportWidth.value / 2
    syncViewport()
  })
  if (timelineScroll.value) resizeObserver.observe(timelineScroll.value)
})
onBeforeUnmount(() => {
  disposed = true
  resizeObserver?.disconnect()
  stopEdgeScroll()
  if (barGesture) {
    barGesture.target.removeEventListener('pointermove', moveBar)
    barGesture.target.removeEventListener('pointerup', endBar)
    barGesture.target.removeEventListener('pointercancel', endBar)
  }
})
function locate(value: string) {
  try { parseCalendarDate(value) } catch { return }
  if (value < '1000-01-01' || value > '9999-12-31') return
  center.value = value
  publish()
  void centerTimeline()
}
async function flush(): Promise<boolean> {
  renameCalendar()
  if ((!draftDirty.value && !dateInputError.value) || props.readonly) return true
  if (rangeError.value) {
    showValidation.value = true
    await nextTick()
    toast(`日历还有未完成的事件：${rangeError.value}`, 'error')
    focusInspector()
    return false
  }
  saveDraft(false)
  return !draftDirty.value
}
async function revealMatch(query: string): Promise<HTMLElement | null> {
  collapsed.value = false
  showList.value = true
  listQuery.value = query
  await nextTick()
  const period = listPeriods.value[0]
  if (period) await locateEvent(period)
  return root.value?.querySelector<HTMLElement>('.yy-calendar-list-text') ?? root.value
}
defineExpose({ flush, isDirty: () => draftDirty.value || !!dateInputError.value || calendarTitle.value !== props.model.title, revealMatch })
</script>

<template>
  <Teleport to="body" :disabled="!expanded">
  <section ref="root" class="yy-calendar-panel" :class="{ expanded, readonly, dragging, collapsed }" tabindex="-1" @keydown="onKey">
    <div class="yy-calendar-block-head">
      <button type="button" class="yy-calendar-toggle" :aria-label="collapsed ? '展开日历内容' : '收起日历内容'" :data-tip="collapsed ? '展开日历内容' : '收起日历内容'" :aria-expanded="!collapsed" @click="toggleCollapsed"><ChevronDown :size="15" /></button>
      <CalendarDays :size="18" />
      <button v-if="readonly" type="button" class="yy-calendar-title yy-calendar-title-button" @click="toggleCollapsed">{{ calendarTitle || '日历' }}</button>
      <input v-else ref="titleInput" v-model="calendarTitle" class="yy-calendar-title" maxlength="120" aria-label="日历名称" placeholder="日历" @change="renameCalendar" @keydown.enter.prevent="!$event.isComposing && (renameCalendar(), titleInput?.blur())" />
      <span class="yy-calendar-block-count">{{ periods.length }} 个事件</span>
      <span v-if="currentCount" class="yy-calendar-current-count">{{ currentCount }} 个进行中</span>
      <div class="yy-calendar-block-actions">
        <IconButton label="复制日历" :disabled="transferring" @click="copyCalendar"><Copy :size="16" /></IconButton>
        <IconButton v-if="!readonly" label="从剪贴板导入（替换当前日历，可撤销）" :disabled="transferring" @click="importCalendar"><ClipboardPaste :size="16" /></IconButton>
        <button v-if="!readonly" type="button" class="yy-btn small primary" @click="newAtCenter"><Plus :size="15" />新建事件</button>
        <IconButton :label="expanded ? '收起日历' : '展开日历'" @click="toggleExpanded"><Minimize2 v-if="expanded" :size="17" /><Maximize2 v-else :size="17" /></IconButton>
      </div>
    </div>
    <section v-show="!collapsed" class="yy-calendar-workspace">
      <div class="yy-calendar-main">
        <div class="yy-calendar-toolbar">
          <div class="yy-calendar-segments" aria-label="时间粒度">
            <button v-for="item in grains" :key="item.value" type="button" :aria-pressed="grain === item.value" :class="{ active: grain === item.value }" @click="setGrain(item.value)">{{ item.label }}</button>
          </div>
          <span class="yy-calendar-window">{{ windowLabel }}</span>
          <button type="button" class="yy-btn small" @click="locate(todayDate())">今天</button>
          <button type="button" class="yy-btn small yy-calendar-list-toggle" :class="{ active: showList }" :aria-expanded="showList" @click="showList = !showList"><ListFilter :size="15" />事件列表</button>
        </div>

        <div class="yy-calendar-frame">
          <div ref="timelineScroll" class="yy-calendar-scroll" @scroll="scrollTimeline" @wheel="wheelTimeline">
            <div
              ref="timeline"
              class="yy-calendar-timeline"
              :style="{ minWidth: `${timelineMinWidth}px`, height: `${timelineHeight}px`, '--calendar-columns': cells.length }"
              @pointerdown="beginCreate"
              @pointermove="moveCreate"
              @pointerup="endCreate"
              @pointercancel="endCreate"
            >
              <div class="yy-calendar-ruler">
                <button v-for="cell in cells" :key="cell.start" type="button" class="yy-calendar-cell" :class="{ current: cell.current, weekend: cell.weekend, boundary: cell.boundary }" :data-date="cell.start" :data-tip="grain === 'day' ? `定位到 ${cell.start}` : `查看 ${cell.primary}${cell.secondary}的${grain === 'year' ? '月份' : '日期'}`" @click="grain === 'day' ? locate(cell.start) : drillCell(cell.start)">
                  <strong>{{ cell.primary }}</strong><span>{{ cell.secondary }}</span>
                </button>
              </div>
              <div class="yy-calendar-grid" aria-hidden="true">
                <span v-for="cell in cells" :key="cell.start" :class="{ current: cell.current, weekend: cell.weekend, boundary: cell.boundary }"></span>
              </div>
              <div v-if="todayGeometry" class="yy-calendar-today-line" :style="{ left: `${todayGeometry.left + todayGeometry.width / 2}%` }" aria-hidden="true"><span>今天</span></div>
              <div v-if="creatingGeometry" class="yy-calendar-selection" :style="{ left: `${creatingGeometry.left}%`, width: `${creatingGeometry.width}%` }">
                <span>{{ periodRangeLabel({ startDate: creatingRange!.start, endDate: creatingRange!.end, precision: grain }) }} · 松开创建</span>
              </div>
              <button
                v-for="entry in visiblePeriods"
                :key="entry.period.id"
                type="button"
                class="yy-calendar-period"
                :class="[`color-${entry.period.color}`, { selected: selectedID === entry.period.id, tiny: entry.geometry.width * axisWidth / 100 < 32, 'clip-start': entry.geometry.clippedStart, 'clip-end': entry.geometry.clippedEnd }]"
                :style="{ left: `${entry.geometry.left}%`, width: `${entry.geometry.width}%`, top: `${72 + entry.lane * 48}px` }"
                :data-tip="`${entry.period.title} · ${periodRangeLabel(entry.period)}${entry.period.note ? ` · ${entry.period.note}` : ''}`"
                @click="$event.detail === 0 && selectPeriod(entry.period)"
                @pointerdown="beginBar($event, entry.period, 'move')"
              >
                <span
                  v-if="!readonly && !entry.geometry.clippedStart && entry.geometry.width * axisWidth / 100 >= 32"
                  class="yy-calendar-resize start"
                  data-tip="调整起点"
                  @pointerdown.stop="beginBar($event, entry.period, 'start')"
                ></span>
                <span class="yy-calendar-period-text"><strong>{{ entry.period.title || '未命名事件' }}</strong><small>{{ periodRangeLabel(entry.period) }}</small></span>
                <span
                  v-if="!readonly && !entry.geometry.clippedEnd && entry.geometry.width * axisWidth / 100 >= 32"
                  class="yy-calendar-resize end"
                  data-tip="调整终点"
                  @pointerdown.stop="beginBar($event, entry.period, 'end')"
                ></span>
              </button>
              <div v-if="dragging && draft && !creatingRange" class="yy-calendar-drag-feedback" :style="{ left: `${scrollLeft + viewportWidth / 2}px` }">{{ periodRangeLabel(draft) }} · {{ periodDays(draft) }} 天</div>
              <div v-if="!periods.length" class="yy-calendar-empty" :style="{ left: `${scrollLeft + viewportWidth / 2}px` }">
                <CalendarDays :size="28" /><strong>从一段时间开始记录</strong><span>{{ readonly ? '编辑文档以添加时间段。' : '拖选时间区间，或点击“新建事件”。' }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showList" class="yy-calendar-list">
          <div class="yy-calendar-list-head"><label><Search :size="15" /><input v-model="listQuery" placeholder="搜索事件或标注" aria-label="搜索日历事件" /><button v-if="listQuery" type="button" aria-label="清空事件搜索" @click="listQuery = ''"><X :size="14" /></button></label><span>{{ listPeriods.length }} 个事件</span></div>
          <div class="yy-calendar-list-rows">
            <button v-for="period in listPeriods" :key="period.id" type="button" class="yy-calendar-list-row" :class="[`color-${period.color}`, { selected: selectedID === period.id }]" @click="selectPeriod(period)">
              <span class="yy-calendar-dot"></span><span class="yy-calendar-list-text"><strong>{{ period.title || '未命名事件' }}</strong><small>{{ periodRangeLabel(period) }} · {{ periodDays(period) }} 天</small><span v-if="period.note">{{ period.note }}</span></span><span class="yy-calendar-status" :class="{ current: periodStatus(period) === '进行中' }">{{ periodStatus(period) }}</span><ChevronRight :size="15" />
            </button>
            <p v-if="!listPeriods.length" class="yy-calendar-list-empty">{{ listQuery ? '没有匹配的事件，试试其他关键词。' : '添加事件后，可以在这里快速查找和定位。' }}</p>
          </div>
        </div>
      </div>

    </section>
  </section>
  </Teleport>
  <Teleport to="body">
    <div v-if="draft && !dragging" class="yy-calendar-inspector-layer" @pointerdown.self="closeDraft()" @wheel="containInspectorScroll" @touchmove="containInspectorScroll">
      <aside v-if="readonly" ref="inspector" class="yy-calendar-inspector yy-calendar-details" role="dialog" aria-modal="true" aria-label="事件详情" tabindex="-1" @keydown="onKey" @pointerdown.stop>
        <div class="yy-calendar-inspector-head"><strong>{{ draft.title }}</strong><IconButton label="关闭详情" @click="closeDraft(true)"><X :size="17" /></IconButton></div>
        <div class="yy-calendar-inspector-body">
          <div class="yy-calendar-detail-meta"><span class="yy-calendar-status" :class="{ current: periodStatus(draft) === '进行中' }">{{ periodStatus(draft) }}</span><span>{{ periodDays(draft) }} 天</span></div>
          <p>{{ periodRangeLabel(draft) }}</p><p class="yy-calendar-note">{{ draft.note || '暂无标注' }}</p>
        </div>
      </aside>
      <aside v-else ref="inspector" class="yy-calendar-inspector" role="dialog" aria-modal="true" :aria-label="draft.id == null ? '新建事件' : '编辑事件'" tabindex="-1" @keydown="onKey" @pointerdown.stop>
        <div class="yy-calendar-inspector-head">
          <div><span>{{ draft.id == null ? '新建事件' : '编辑事件' }} <em>{{ draftDirty ? '待应用' : draft.id == null ? '' : '已应用' }}</em></span><small>{{ periodRangeLabel(draftAsPeriod()!) }} · {{ rangeError ? '' : `${periodDays(draft)} 天` }}</small></div>
          <IconButton label="关闭" @click="closeDraft()"><X :size="17" /></IconButton>
        </div>

        <div class="yy-calendar-inspector-body">
          <label class="yy-calendar-field">
            <span>事件名称 <small>{{ [...draft.title].length }}/120</small></span>
            <input v-model="draft.title" name="calendar-title" class="yy-input" maxlength="120" placeholder="例如：专注学习、项目冲刺、休整" />
          </label>

          <DateRangeField :start="draft.startDate" :end="draft.endDate" :precision="draft.precision" @change="changeDraftDates" @invalid="dateInputError = $event" />
          <div class="yy-calendar-duration"><span>快捷时长</span><button v-for="amount in (draft.precision === 'day' ? [1, 7, 14, 30] : [1, 3, 6, 12])" :key="amount" type="button" @click="setDuration(amount)">{{ amount }}{{ draft.precision === 'year' ? '年' : draft.precision === 'month' ? '个月' : '天' }}</button></div>
          <p v-if="rangeError && (showValidation || draft.title.trim())" class="yy-calendar-field-error" role="status">{{ rangeError }}</p>

          <div class="yy-calendar-field">
            <span>颜色</span>
            <div class="yy-calendar-colors">
              <button v-for="color in colors" :key="color.value" type="button" :class="[`color-${color.value}`, { active: draft.color === color.value }]" :aria-label="color.label" :data-tip="color.label" @click="draft.color = color.value">
                <Check v-if="draft.color === color.value" :size="14" />
              </button>
            </div>
          </div>

          <label class="yy-calendar-field grow">
            <span>简单标注 <small>{{ [...draft.note].length }}/2000</small></span>
            <textarea v-model="draft.note" class="yy-input yy-textarea" maxlength="2000" rows="4" placeholder="记录这一阶段的重点、感受或背景。"></textarea>
          </label>
        </div>
        <div class="yy-calendar-inspector-actions">
          <button v-if="draft.id != null" type="button" class="yy-btn danger-text" @click="removeDraft"><Trash2 :size="15" />删除</button>
          <span class="yy-spacer"></span>
          <button type="button" class="yy-btn" @click="closeDraft()">取消</button>
          <IconButton v-if="draft.id != null" label="复制为新事件" @click="duplicateDraft"><Copy :size="15" /></IconButton>
          <button type="button" class="yy-btn primary" :disabled="!!rangeError || (draft.id != null && !draftDirty)" @click="saveDraft()"><Save :size="15" />应用</button>
        </div>
        <p class="yy-calendar-shortcut">⌘/Ctrl + Enter 应用 · Esc 关闭</p>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.yy-calendar-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
.yy-calendar-main { min-width: 0; border: 1px solid var(--yy-border); border-radius: 12px; background: var(--yy-bg); }
.yy-calendar-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 58px; padding: 10px 12px; border-bottom: 1px solid var(--yy-border); }
.yy-calendar-segments { display: inline-flex; flex: none; padding: 3px; border-radius: 8px; background: var(--yy-bg-muted); }
.yy-calendar-segments button { min-width: 40px; height: 28px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--yy-text-2); cursor: pointer; }
.yy-calendar-segments button.active { background: var(--yy-bg); color: var(--yy-text); box-shadow: 0 1px 4px #00000012; font-weight: 600; }
.yy-calendar-window { flex: 1; min-width: 170px; text-align: center; color: var(--yy-text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.yy-calendar-frame { overflow: hidden; border-radius: 0 0 12px 12px; }
.yy-calendar-scroll { overflow: auto hidden; overscroll-behavior-x: contain; scrollbar-width: none; overflow-anchor: none; }
.yy-calendar-scroll::-webkit-scrollbar { display: none; }
.yy-calendar-timeline { position: relative; isolation: isolate; overflow: clip; touch-action: pan-x pan-y; user-select: none; cursor: crosshair; }
.yy-calendar-ruler, .yy-calendar-grid { display: grid; grid-template-columns: repeat(var(--calendar-columns), minmax(0, 1fr)); }
.yy-calendar-ruler { position: relative; z-index: 4; height: 58px; border-bottom: 1px solid var(--yy-border); background: var(--yy-bg-muted); }
.yy-calendar-cell { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-width: 0; padding: 0; border: 0; border-left: 1px solid var(--yy-border); background: transparent; color: var(--yy-text-3); font: inherit; font-size: 10px; line-height: 1.25; cursor: pointer; }
.yy-calendar-cell:hover { background: var(--yy-bg-hover); }
.yy-calendar-cell:first-child { border-left: 0; }
.yy-calendar-cell strong { color: var(--yy-text-2); font-size: 12px; font-weight: 550; font-variant-numeric: tabular-nums; }
.yy-calendar-cell.current { background: var(--yy-primary-soft); }
.yy-calendar-cell.current strong { color: var(--yy-primary); }
.yy-calendar-cell.weekend { background: color-mix(in srgb, var(--yy-bg-active) 48%, transparent); }
.yy-calendar-cell.boundary { border-left-color: var(--yy-border-strong); }
.yy-calendar-grid { position: absolute; z-index: -1; inset: 58px 0 0; pointer-events: none; }
.yy-calendar-grid span { border-left: 1px solid color-mix(in srgb, var(--yy-border) 72%, transparent); }
.yy-calendar-grid span.current { background: color-mix(in srgb, var(--yy-primary-soft) 45%, transparent); }
.yy-calendar-grid span.weekend { background: color-mix(in srgb, var(--yy-bg-muted) 62%, transparent); }
.yy-calendar-grid span.boundary { border-left-color: var(--yy-border-strong); }
.yy-calendar-period { container-type: inline-size; --period: #00a66a; --period-soft: #dff7ed; position: absolute; z-index: 2; display: flex; align-items: center; min-width: 9px; height: 38px; padding: 0 12px; overflow: clip; border: 1px solid color-mix(in srgb, var(--period) 38%, transparent); border-left: 3px solid var(--period); border-radius: 7px; background: color-mix(in srgb, var(--period) 12%, var(--yy-bg)); color: color-mix(in srgb, var(--period) 65%, var(--yy-text)); box-shadow: 0 2px 5px #0000000d; cursor: grab; text-align: left; transition: box-shadow .15s, background .15s; }
.yy-calendar-period:hover { z-index: 5; border-color: var(--period); box-shadow: 0 4px 12px #00000016; }
.yy-calendar-period:active { cursor: grabbing; }
.yy-calendar-period.tiny { padding: 0; border-left-width: 1px; }
.yy-calendar-period.tiny .yy-calendar-period-text { display: none; }
.yy-calendar-period.selected { z-index: 4; border-color: var(--period); box-shadow: 0 0 0 2px color-mix(in srgb, var(--period) 24%, transparent), 0 4px 12px #00000016; }
.yy-calendar-period.clip-start { border-left-style: dashed; border-radius: 2px 7px 7px 2px; }
.yy-calendar-period.clip-end { border-right-style: dashed; border-radius: 7px 2px 2px 7px; }
.yy-calendar-period-text { position: sticky; left: 12px; display: flex; align-items: baseline; gap: 8px; min-width: 0; max-width: calc(100% - 12px); pointer-events: none; }
.yy-calendar-period-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
.yy-calendar-period-text small { flex: none; opacity: .72; font-size: 10px; font-variant-numeric: tabular-nums; }
.yy-calendar-today-line { position: absolute; z-index: 1; top: 58px; bottom: 0; width: 1px; background: color-mix(in srgb, var(--yy-primary) 45%, transparent); pointer-events: none; }
.yy-calendar-today-line span { position: absolute; left: 0; bottom: 5px; padding: 1px 6px; border-radius: 8px; background: var(--yy-primary-soft); color: var(--yy-primary); font-size: 10px; white-space: nowrap; transform: translateX(-50%); }
.yy-calendar-drag-feedback { position: absolute; z-index: 6; bottom: 6px; padding: 5px 12px; border: 1px solid var(--yy-border); border-radius: 20px; background: var(--yy-bg); box-shadow: 0 3px 12px #0002; color: var(--yy-text); font-size: 12px; white-space: nowrap; pointer-events: none; transform: translateX(-50%); }
.dragging .yy-calendar-period { transition: none; }
.yy-calendar-list { border-top: 1px solid var(--yy-border); }
.yy-calendar-list-head { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--yy-bg-muted); }
.yy-calendar-list-head > label { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; color: var(--yy-text-3); }
.yy-calendar-list-head input { width: 100%; min-width: 0; padding: 4px 0; border: 0; background: transparent; color: var(--yy-text); font: inherit; }
.yy-calendar-list-head button { display: grid; place-items: center; padding: 5px; border: 0; background: transparent; color: var(--yy-text-3); cursor: pointer; }
.yy-calendar-list-head > span { color: var(--yy-text-3); font-size: 11px; white-space: nowrap; }
.yy-calendar-list-rows { max-height: 300px; overflow: auto; overscroll-behavior: contain; padding: 4px; }
.yy-calendar-list-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 0; border-radius: 7px; background: transparent; color: var(--yy-text); font: inherit; text-align: left; cursor: pointer; }
.yy-calendar-list-row:hover { background: var(--yy-bg-muted); }
.yy-calendar-list-row.selected { background: color-mix(in srgb, var(--period) 10%, var(--yy-bg)); }
.yy-calendar-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--period); }
.yy-calendar-list-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.yy-calendar-list-text > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yy-calendar-list-text strong { font-size: 12px; font-weight: 600; }
.yy-calendar-list-text small, .yy-calendar-list-text > span { color: var(--yy-text-3); font-size: 11px; }
.yy-calendar-list-row > .lucide { color: var(--yy-text-4); flex: none; }
.yy-calendar-status { flex: none; padding: 2px 7px; border-radius: 10px; background: var(--yy-bg-muted); color: var(--yy-text-3); font-size: 10px; white-space: nowrap; }
.yy-calendar-status.current, .yy-calendar-current-count { background: var(--yy-primary-soft); color: var(--yy-primary); }
.yy-calendar-current-count { padding: 2px 7px; border-radius: 10px; font-size: 10px; white-space: nowrap; }
.yy-calendar-detail-meta { display: flex; align-items: center; gap: 8px; margin-top: 14px; color: var(--yy-text-3); font-size: 11px; }
.yy-calendar-list-empty { padding: 16px 10px; color: var(--yy-text-3); text-align: center; font-size: 12px; }
.yy-calendar-list-toggle.active { background: var(--yy-primary-soft); color: var(--yy-primary); border-color: transparent; }
.yy-calendar-duration { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin-top: 9px; }
.yy-calendar-duration > span { margin-right: 4px; color: var(--yy-text-3); font-size: 10px; }
.yy-calendar-duration button { padding: 3px 7px; border: 1px solid var(--yy-border); border-radius: 6px; background: var(--yy-bg); color: var(--yy-text-2); font: inherit; font-size: 10px; cursor: pointer; }
.yy-calendar-duration button:hover { border-color: var(--yy-primary); color: var(--yy-primary); }
.yy-calendar-inspector-head em { margin-left: 4px; color: var(--yy-text-3); font-size: 10px; font-weight: 400; font-style: normal; }
.yy-calendar-resize { position: absolute; top: 5px; bottom: 5px; width: 8px; border-radius: 3px; cursor: ew-resize; }
.yy-calendar-resize.start { left: 2px; }
.yy-calendar-resize.end { right: 2px; }
.yy-calendar-period:hover .yy-calendar-resize::after, .yy-calendar-period.selected .yy-calendar-resize::after { content: ''; position: absolute; left: 3px; top: 5px; bottom: 5px; width: 2px; border-radius: 1px; background: var(--period); opacity: .55; }
.yy-calendar-selection { position: absolute; z-index: 1; top: 58px; bottom: 0; border: 1px dashed var(--yy-primary); background: color-mix(in srgb, var(--yy-primary-soft) 60%, transparent); pointer-events: none; }
.yy-calendar-selection span { position: absolute; top: 8px; left: 50%; padding: 2px 7px; border-radius: 10px; background: var(--yy-primary); color: #fff; font-size: 10px; white-space: nowrap; transform: translateX(-50%); }
.yy-calendar-empty { position: absolute; z-index: 1; left: 50%; top: 84px; display: flex; flex-direction: column; align-items: center; color: var(--yy-text-3); transform: translateX(-50%); pointer-events: none; }
.yy-calendar-empty strong { margin-top: 5px; color: var(--yy-text-2); }
.yy-calendar-empty span { font-size: 12px; }
.yy-calendar-inspector-layer { position: fixed; z-index: 84; inset: 0; display: grid; place-items: center; padding: 16px; }
.yy-calendar-inspector { display: flex; flex-direction: column; width: min(460px, 100%); min-width: 0; max-height: calc(100dvh - 32px); overflow: hidden; border: 1px solid var(--yy-border); border-radius: 16px; background: var(--yy-bg); box-shadow: 0 20px 70px #0003, 0 4px 16px #0001; font: 13px/1.5 var(--yy-font, sans-serif); color: var(--yy-text); }
.yy-calendar-inspector-body { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 20px 18px; }
.yy-calendar-inspector-body > .yy-calendar-field:first-child { margin-top: 16px; }
.yy-calendar-inspector-head { display: flex; flex: none; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px 13px; border-bottom: 1px solid var(--yy-border); }
.yy-calendar-inspector-head > div { min-width: 0; }
.yy-calendar-inspector-head span, .yy-calendar-inspector-head small { display: block; }
.yy-calendar-inspector-head span { font-weight: 650; }
.yy-calendar-inspector-head small { margin-top: 2px; overflow: hidden; color: var(--yy-text-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.yy-calendar-field { display: flex; flex-direction: column; gap: 5px; margin-top: 14px; }
.yy-calendar-field > span { display: flex; justify-content: space-between; color: var(--yy-text-2); font-size: 12px; }
.yy-calendar-field > span small { color: var(--yy-text-4); font-weight: 400; }
.yy-calendar-field-error { margin: 5px 0 0; color: var(--yy-danger); font-size: 11px; }
.yy-calendar-colors { display: flex; flex-wrap: wrap; gap: 8px; }
.yy-calendar-colors button { --period: #00a66a; display: grid; place-items: center; width: 27px; height: 27px; padding: 0; border: 2px solid transparent; border-radius: 50%; background: var(--period); color: #fff; cursor: pointer; }
.yy-calendar-colors button.active { border-color: var(--yy-bg); box-shadow: 0 0 0 2px var(--period); }
.color-emerald { --period: #00a66a !important; --period-soft: #dff7ed !important; }
.color-blue { --period: #3b76d6 !important; --period-soft: #e5efff !important; }
.color-violet { --period: #7b61c9 !important; --period-soft: #eee9ff !important; }
.color-amber { --period: #c77a12 !important; --period-soft: #fff0d5 !important; }
.color-rose { --period: #cc5b78 !important; --period-soft: #fde8ee !important; }
.color-cyan { --period: #168ca5 !important; --period-soft: #ddf4f7 !important; }
.color-slate { --period: #69747d !important; --period-soft: #e9edef !important; }
.color-lime { --period: #6d9418 !important; --period-soft: #edf6d8 !important; }
.yy-calendar-field.grow textarea { min-height: 110px; max-height: 260px; }
.yy-calendar-inspector-actions { display: flex; flex: none; align-items: center; gap: 7px; padding: 14px 20px 0; border-top: 1px solid var(--yy-border); }
.yy-calendar-shortcut { flex: none; margin: 8px 20px 14px; color: var(--yy-text-4); font-size: 10px; text-align: right; }
@media (max-width: 650px) {
  .yy-calendar-main { border-radius: 10px; }
  .yy-calendar-inspector-layer { padding: 12px; }
  .yy-calendar-inspector { max-height: calc(100dvh - 24px); }
  .yy-calendar-inspector-head { padding: 14px 16px 12px; }
  .yy-calendar-inspector-body { padding: 0 16px 16px; }
  .yy-calendar-inspector-actions { padding: 12px 16px; }
  .yy-calendar-toolbar { gap: 6px; padding: 9px; }
  .yy-calendar-window { order: 3; flex: 1 0 100%; padding-top: 5px; }
  .yy-calendar-period-text small { display: none; }
  .yy-calendar-shortcut { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .yy-calendar-period { transition: none; }
}
.yy-calendar-panel { width: 100%; padding: 0; margin: 0; container-type: inline-size; font: 13px/1.5 var(--yy-font, sans-serif); color: var(--yy-text); }
.yy-calendar-block-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 40px; padding: 5px 8px 5px 6px; border: 1px solid var(--yy-border); border-bottom: 0; border-radius: 8px 8px 0 0; background: var(--yy-bg); }
.yy-calendar-toggle { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: var(--yy-radius-sm); background: none; color: var(--yy-text-3); cursor: pointer; }
.yy-calendar-toggle:hover { background: var(--yy-bg-hover); color: var(--yy-text-2); }
.yy-calendar-toggle svg { transition: transform .15s; }
.collapsed .yy-calendar-toggle svg { transform: rotate(-90deg); }
.collapsed .yy-calendar-block-head { border-bottom: 1px solid var(--yy-border); border-radius: 8px; }
.yy-calendar-block-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.yy-calendar-block-head > .lucide { color: var(--yy-primary); flex: none; }
.yy-calendar-title { flex: 1; min-width: 60px; width: 0; height: 28px; padding: 0 4px; border: 0; background: transparent; color: var(--yy-text); font: inherit; font-weight: 650; }
.yy-calendar-title-button { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.yy-calendar-block-count { color: var(--yy-text-3); font-size: 11px; white-space: nowrap; }
.yy-calendar-main { border-radius: 0 0 12px 12px; box-shadow: none; }
.yy-calendar-note { white-space: pre-wrap; overflow-wrap: anywhere; }
.readonly .yy-calendar-timeline, .readonly .yy-calendar-period { cursor: default; }
.yy-calendar-panel.expanded { position: fixed; z-index: 80; inset: 16px; width: auto; overflow: auto; padding: 20px; background: var(--yy-bg); border: 1px solid var(--yy-border); border-radius: 16px; box-shadow: 0 0 0 100vmax #0008; }
@container (max-width: 160px) {
  .yy-calendar-period-text small { display: none; }
}
@container (max-width: 680px) {
  .yy-calendar-window { order: 4; flex: 1 0 100%; }
  .yy-calendar-block-count { display: none; }
}
@container (max-width: 420px) {
  .yy-calendar-toolbar { gap: 6px; padding: 9px; }
  .yy-calendar-list-toggle { margin-left: auto; }
  .yy-calendar-current-count { display: none; }
}
</style>
