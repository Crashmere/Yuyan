<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, LocateFixed,
  Plus, Save, Trash2, X, Maximize2, Minimize2, Copy, ClipboardPaste,
} from 'lucide-vue-next'
import { errorMessage } from '../shared/api'
import { confirm, prompt } from '../ui/dialog'
import { copyText } from '../shared/clipboard'
import { decodeCalendar, encodeCalendar } from './transfer'
import IconButton from '../ui/IconButton.vue'
import { toast } from '../ui/toast'
import {
  addUnits, assignPeriodLanes, canonicalRange, parseCalendarDate, periodGeometry,
  periodRangeLabel, todayDate, unitBounds, windowCells,
} from './dates'
import type { CalendarData, CalendarEntry, CalendarPrecision } from '../schema/calendar'

const props = defineProps<{ model: CalendarData; readonly?: boolean }>()
const emit = defineEmits<{ change: [value: CalendarData]; undo: [redo: boolean] }>()
const root = ref<HTMLElement | null>(null)
const expanded = ref(false)
async function toggleExpanded(event?: MouseEvent) {
  const focused = event?.currentTarget as HTMLElement | undefined
    ?? (root.value?.contains(document.activeElement) ? document.activeElement as HTMLElement : root.value)
  expanded.value = !expanded.value
  await nextTick()
  // Teleport moves the focused control out of its parent; restore focus after the move.
  if (!disposed) focused?.focus({ preventScroll: true })
}
const calendarTitle = ref(props.model.title)
function calendarData(): CalendarData {
  return { version: 1, title: calendarTitle.value, grain: grain.value, center: center.value,
    periods: periods.value.map(period => ({ ...period })) }
}
function publish() {
  if (props.readonly) return
  emit('change', calendarData())
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
      periods.value = data.periods.map(p => ({ ...p }))
      draft.value = null
      emit('change', data)
      await centerTimeline()
      if (!disposed) toast(`已导入 ${data.periods.length} 个状态，可撤销恢复原日历`, 'success')
      return
    }
  } finally { transferring.value = false }
}
function syncModel() {
  calendarTitle.value = props.model.title
  grain.value = props.model.grain
  center.value = props.model.center || todayDate()
  periods.value = props.model.periods.map(p => ({ ...p }))
}
watch(() => props.model, () => {
  const previous = JSON.stringify(periods.value)
  syncModel()
  // Undo or external document updates replace the state inspector as well.
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
const periods = ref<CalendarEntry[]>(props.model.periods.map(p => ({ ...p })))
const timelineScroll = ref<HTMLElement | null>(null)
const timeline = ref<HTMLElement | null>(null)

interface Draft extends Omit<CalendarEntry, 'id'> {
  id: number | null
}
const draft = ref<Draft | null>(null)
const draftBaseline = ref('')

const cells = computed(() => windowCells(center.value, grain.value))
const windowStart = computed(() => cells.value[0]?.start ?? center.value)
const windowEnd = computed(() => cells.value.at(-1)?.end ?? center.value)
const windowLabel = computed(() => periodRangeLabel({ startDate: windowStart.value, endDate: windowEnd.value, precision: grain.value }))
const timelineMinWidth = computed(() => grain.value === 'year' ? 1032 : grain.value === 'month' ? 1404 : 2688)

function draftAsPeriod(): CalendarEntry | null {
  if (!draft.value) return null
  return {
    ...draft.value,
    id: draft.value.id ?? -1,
  }
}

const renderedPeriods = computed(() => {
  const preview = draftAsPeriod()
  if (!preview) return periods.value
  if (preview.id === -1) return [...periods.value, preview]
  return periods.value.map((period) => period.id === preview.id ? preview : period)
})
const laneLayout = computed(() => assignPeriodLanes(renderedPeriods.value))
const visiblePeriods = computed(() => renderedPeriods.value.flatMap((period) => {
  const geometry = periodGeometry(period, cells.value)
  return geometry ? [{ period, geometry, lane: laneLayout.value.lanes.get(period.id) ?? 0 }] : []
}))
const laneCount = computed(() => Math.max(3, laneLayout.value.count))
const timelineHeight = computed(() => 58 + laneCount.value * 44 + 26)
const selectedID = computed(() => draft.value?.id ?? (draft.value ? -1 : null))
const draftDirty = computed(() => !!draft.value && JSON.stringify(draftPayload(draft.value)) !== draftBaseline.value)
const rangeError = computed(() => {
  const value = draft.value
  if (!value) return ''
  if (value.id == null && periods.value.length >= 2000) return '单个日历最多保存 2,000 个状态'
  if (!value.title.trim()) return '请填写状态名称'
  if ([...value.title.trim()].length > 120) return '状态名称不能超过 120 个字符'
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
  void nextTick(() => root.value?.querySelector<HTMLInputElement>('.yy-calendar-inspector input[name="calendar-title"]')?.focus())
}

async function newAtCenter() {
  if (props.readonly) return
  if (periods.value.length >= 2000) { toast('单个日历最多保存 2,000 个状态', 'info'); return }
  if (draftDirty.value) {
    const ok = await confirm({ title: '新建另一个状态？', message: '当前未保存的修改会被放弃。', confirmText: '放弃并新建', danger: true })
    if (!ok) return
  }
  const anchor = center.value >= windowStart.value && center.value <= windowEnd.value ? center.value : todayDate()
  const range = unitBounds(anchor, grain.value)
  openNew(range.start, range.end)
}

async function closeDraft(force = false) {
  if (!draft.value) return
  if (!force && draftDirty.value) {
    const ok = await confirm({ title: '放弃未保存的修改？', message: '时间、名称或标注的修改还没有保存。', confirmText: '放弃修改', danger: true })
    if (!ok) return
  }
  draft.value = null
}

function saveDraft() {
  const value = draft.value
  if (!value || props.readonly) return
  if (rangeError.value) {
    toast(rangeError.value, 'error')
    return
  }
  const saved: CalendarEntry = {
    ...draftPayload(value), title: value.title.trim(), note: value.note.trim(),
    id: value.id ?? Math.max(0, ...periods.value.map(p => p.id)) + 1,
  }
  const index = periods.value.findIndex(period => period.id === saved.id)
  if (index >= 0) periods.value.splice(index, 1, saved)
  else periods.value.push(saved)
  periods.value.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id - b.id)
  openPeriod(saved)
  publish()
  toast('状态已应用到文档', 'success')
}

async function removeDraft() {
  const value = draft.value
  if (!value || value.id == null || props.readonly) return
  const ok = await confirm({ title: `删除“${value.title}”？`, message: '这个时间段和标注会从文档日历移除，可以通过文档撤销恢复。', confirmText: '删除', danger: true })
  if (!ok || disposed) return
  periods.value = periods.value.filter(period => period.id !== value.id)
  await closeDraft(true)
  publish()
  toast('状态已删除', 'success')
}

function setDraftPrecision(precision: CalendarPrecision) {
  if (!draft.value || draft.value.precision === precision) return
  const range = canonicalRange(draft.value.startDate, draft.value.endDate, precision)
  Object.assign(draft.value, range, { precision })
}

function boundaryValue(side: 'start' | 'end'): string {
  const value = draft.value
  if (!value) return ''
  const date = side === 'start' ? value.startDate : value.endDate
  return value.precision === 'year' ? date.slice(0, 4) : value.precision === 'month' ? date.slice(0, 7) : date
}

function changeBoundary(side: 'start' | 'end', event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!draft.value || !value) return
  let date = value
  if (draft.value.precision === 'year') date = `${value.padStart(4, '0')}-${side === 'start' ? '01-01' : '12-31'}`
  else if (draft.value.precision === 'month') date = side === 'start' ? `${value}-01` : unitBounds(`${value}-01`, 'month').end
  if (side === 'start') draft.value.startDate = date
  else draft.value.endDate = date
}

function shiftWindow(direction: -1 | 1) {
  const amount = grain.value === 'year' ? 10 : grain.value === 'month' ? 15 : 35
  const next = addUnits(center.value, grain.value, direction * amount)
  center.value = next.length > 10 || next > '9999-12-31' ? '9999-12-31' : next < '1000-01-01' ? '1000-01-01' : next
  publish()
}

async function centerTimeline() {
  await nextTick()
  const element = timelineScroll.value
  if (element) element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2)
}

watch(grain, () => void centerTimeline())
watch(center, () => void centerTimeline())

interface CreateGesture {
  pointerId: number
  startIndex: number
  index: number
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
  if (draftDirty.value) {
    toast('请先保存或取消当前修改', 'info')
    return
  }
  const index = cellIndex(event.clientX)
  createGesture = { pointerId: event.pointerId, startIndex: index, index }
  creatingRange.value = { start: cells.value[index].start, end: cells.value[index].end }
  timeline.value.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function moveCreate(event: PointerEvent) {
  if (!createGesture || event.pointerId !== createGesture.pointerId) return
  const index = cellIndex(event.clientX)
  if (index === createGesture.index) return
  createGesture.index = index
  const first = Math.min(index, createGesture.startIndex)
  const last = Math.max(index, createGesture.startIndex)
  creatingRange.value = { start: cells.value[first].start, end: cells.value[last].end }
}

function endCreate(event: PointerEvent) {
  if (!createGesture || event.pointerId !== createGesture.pointerId) return
  const range = creatingRange.value
  createGesture = null
  creatingRange.value = null
  if (range) openNew(range.start, range.end)
}

type BarMode = 'move' | 'start' | 'end'
interface BarGesture {
  pointerId: number
  startX: number
  period: CalendarEntry
  mode: BarMode
  moved: boolean
  target: HTMLElement
}
let barGesture: BarGesture | null = null

function beginBar(event: PointerEvent, period: CalendarEntry, mode: BarMode, clipped: boolean) {
  event.stopPropagation()
  if (period.id === -1) return
  if (props.readonly) { openPeriod(period); return }
  if (draftDirty.value && draft.value?.id !== period.id) {
    toast('请先保存或取消当前修改', 'info')
    return
  }
  if (event.pointerType === 'touch' || event.button !== 0 || clipped) {
    if ((event.pointerType === 'touch' || clipped) && mode === 'move' && draft.value?.id !== period.id) openPeriod(period)
    return
  }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  barGesture = { pointerId: event.pointerId, startX: event.clientX, period, mode, moved: false, target }
  target.addEventListener('pointermove', moveBar)
  target.addEventListener('pointerup', endBar)
  target.addEventListener('pointercancel', endBar)
  event.preventDefault()
}

function moveBar(event: PointerEvent) {
  const gesture = barGesture
  if (!gesture || gesture.pointerId !== event.pointerId || !timeline.value) return
  const cellWidth = timeline.value.getBoundingClientRect().width / cells.value.length
  const distance = event.clientX - gesture.startX
  if (!gesture.moved && Math.abs(distance) < 5) return
  gesture.moved = true
  const delta = Math.round(distance / cellWidth)
  const base = canonicalRange(gesture.period.startDate, gesture.period.endDate, grain.value)
  let startDate = base.startDate
  let endDate = base.endDate
  if (gesture.mode === 'move') {
    startDate = unitBounds(addUnits(base.startDate, grain.value, delta), grain.value).start
    endDate = unitBounds(addUnits(base.endDate, grain.value, delta), grain.value).end
  } else if (gesture.mode === 'start') {
    startDate = unitBounds(addUnits(base.startDate, grain.value, delta), grain.value).start
    if (startDate > endDate) startDate = unitBounds(endDate, grain.value).start
  } else {
    endDate = unitBounds(addUnits(base.endDate, grain.value, delta), grain.value).end
    if (endDate < startDate) endDate = unitBounds(startDate, grain.value).end
  }
  if (draft.value?.id !== gesture.period.id) openPeriod(gesture.period)
  if (draft.value) Object.assign(draft.value, { startDate, endDate, precision: grain.value })
}

function endBar(event: PointerEvent) {
  const gesture = barGesture
  if (!gesture || gesture.pointerId !== event.pointerId) return
  gesture.target.removeEventListener('pointermove', moveBar)
  gesture.target.removeEventListener('pointerup', endBar)
  gesture.target.removeEventListener('pointercancel', endBar)
  barGesture = null
  if (!gesture.moved) {
    if (draft.value?.id !== gesture.period.id) openPeriod(gesture.period)
    return
  }
  toast('日期已调整，保存后生效', 'info')
}

function onKey(event: KeyboardEvent) {
  event.stopPropagation()
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

onMounted(centerTimeline)
onBeforeUnmount(() => {
  disposed = true
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
}
async function flush(): Promise<boolean> {
  if (!draftDirty.value || props.readonly) return true
  if (rangeError.value) {
    toast(`日历还有未完成的状态：${rangeError.value}`, 'error')
    root.value?.scrollIntoView({ block: 'center' })
    root.value?.querySelector<HTMLInputElement>('[name="calendar-title"]')?.focus()
    return false
  }
  saveDraft()
  return !draftDirty.value
}
defineExpose({ flush, isDirty: () => draftDirty.value })
</script>

<template>
  <Teleport to="body" :disabled="!expanded">
  <section ref="root" class="yy-calendar-panel" :class="{ expanded, readonly }" tabindex="-1" @keydown="onKey">
    <div class="yy-calendar-block-head">
      <CalendarDays :size="18" />
      <strong v-if="readonly">{{ calendarTitle || '日历' }}</strong>
      <input v-else v-model="calendarTitle" class="yy-calendar-title" maxlength="120" aria-label="日历名称" placeholder="日历名称" @change="publish" />
      <span class="yy-calendar-block-count">{{ periods.length }} 个状态</span>
      <div class="yy-calendar-block-actions">
        <IconButton label="复制日历" :disabled="transferring" @click="copyCalendar"><Copy :size="16" /></IconButton>
        <IconButton v-if="!readonly" label="从剪贴板导入（替换当前日历，可撤销）" :disabled="transferring" @click="importCalendar"><ClipboardPaste :size="16" /></IconButton>
        <button v-if="!readonly" type="button" class="yy-btn small primary" @click="newAtCenter"><Plus :size="15" />新建状态</button>
        <IconButton :label="expanded ? '收起日历' : '展开日历'" @click="toggleExpanded"><Minimize2 v-if="expanded" :size="17" /><Maximize2 v-else :size="17" /></IconButton>
      </div>
    </div>
    <section class="yy-calendar-workspace" :class="{ 'has-inspector': draft }">
      <div class="yy-calendar-main">
        <div class="yy-calendar-toolbar">
          <div class="yy-calendar-segments" aria-label="时间粒度">
            <button v-for="item in grains" :key="item.value" type="button" :class="{ active: grain === item.value }" @click="grain = item.value; publish()">{{ item.label }}</button>
          </div>
          <div class="yy-calendar-navigate">
            <IconButton label="上一段时间" @click="shiftWindow(-1)"><ChevronLeft :size="17" /></IconButton>
            <span class="yy-calendar-window">{{ windowLabel }}</span>
            <IconButton label="下一段时间" @click="shiftWindow(1)"><ChevronRight :size="17" /></IconButton>
          </div>
          <label class="yy-calendar-locate">
            <LocateFixed :size="15" />
            <input :value="center" @change="locate(($event.target as HTMLInputElement).value)" type="date" min="1000-01-01" max="9999-12-31" aria-label="定位日期" />
          </label>
          <button type="button" class="yy-btn small" @click="locate(todayDate())">今天</button>
        </div>

        <div class="yy-calendar-frame">
          <div ref="timelineScroll" class="yy-calendar-scroll">
            <div
              ref="timeline"
              class="yy-calendar-timeline"
              :style="{ minWidth: `${timelineMinWidth}px`, height: `${timelineHeight}px`, '--calendar-columns': cells.length }"
              @pointerdown="beginCreate"
              @pointermove="moveCreate"
              @pointerup="endCreate"
              @pointercancel="endCreate"
            >
              <div class="yy-calendar-ruler" aria-hidden="true">
                <div v-for="cell in cells" :key="cell.start" class="yy-calendar-cell" :class="{ current: cell.current, weekend: cell.weekend, boundary: cell.boundary }">
                  <strong>{{ cell.primary }}</strong><span>{{ cell.secondary }}</span>
                </div>
              </div>
              <div class="yy-calendar-grid" aria-hidden="true">
                <span v-for="cell in cells" :key="cell.start" :class="{ current: cell.current, weekend: cell.weekend, boundary: cell.boundary }"></span>
              </div>
              <div v-if="creatingGeometry" class="yy-calendar-selection" :style="{ left: `${creatingGeometry.left}%`, width: `${creatingGeometry.width}%` }">
                <span>松开以创建</span>
              </div>
              <button
                v-for="entry in visiblePeriods"
                :key="entry.period.id"
                type="button"
                class="yy-calendar-period"
                :class="[`color-${entry.period.color}`, { selected: selectedID === entry.period.id, 'clip-start': entry.geometry.clippedStart, 'clip-end': entry.geometry.clippedEnd }]"
                :style="{ left: `${entry.geometry.left}%`, width: `${entry.geometry.width}%`, top: `${70 + entry.lane * 44}px` }"
                :data-tip="`${entry.period.title} · ${periodRangeLabel(entry.period)}${entry.period.note ? ` · ${entry.period.note}` : ''}`"
                @click="$event.detail === 0 && !draftDirty && openPeriod(entry.period)"
                @pointerdown="beginBar($event, entry.period, 'move', entry.geometry.clippedStart || entry.geometry.clippedEnd)"
              >
                <span
                  v-if="!readonly && !entry.geometry.clippedStart"
                  class="yy-calendar-resize start"
                  data-tip="调整起点"
                  @pointerdown.stop="beginBar($event, entry.period, 'start', false)"
                ></span>
                <span class="yy-calendar-period-text"><strong>{{ entry.period.title || '未命名状态' }}</strong><small>{{ periodRangeLabel(entry.period) }}</small></span>
                <span
                  v-if="!readonly && !entry.geometry.clippedEnd"
                  class="yy-calendar-resize end"
                  data-tip="调整终点"
                  @pointerdown.stop="beginBar($event, entry.period, 'end', false)"
                ></span>
              </button>
              <div v-if="!periods.length && !draft" class="yy-calendar-empty">
                <CalendarDays :size="28" /><strong>还没有状态</strong><span>{{ readonly ? '编辑文档以添加时间段。' : '拖过时间轴，或用“新建状态”开始记录。' }}</span>
              </div>
            </div>
          </div>
          <div class="yy-calendar-caption" v-if="!readonly"><span>拖动空白处创建区间</span><span>拖动状态条可移动，拖动两端可调整范围</span></div>
        </div>
      </div>

      <aside v-if="draft && readonly" class="yy-calendar-inspector yy-calendar-details">
        <div class="yy-calendar-inspector-head"><strong>{{ draft.title }}</strong><IconButton label="关闭详情" @click="closeDraft(true)"><X :size="17" /></IconButton></div>
        <p>{{ periodRangeLabel(draft) }}</p><p class="yy-calendar-note">{{ draft.note || '暂无标注' }}</p>
      </aside>
      <aside v-else-if="draft" class="yy-calendar-inspector" aria-label="状态编辑器">
        <div class="yy-calendar-inspector-head">
          <div><span>{{ draft.id == null ? '新状态' : '状态详情' }}</span><small>{{ periodRangeLabel(draftAsPeriod()!) }}</small></div>
          <IconButton label="关闭" @click="closeDraft()"><X :size="17" /></IconButton>
        </div>

        <label class="yy-calendar-field">
          <span>状态名称 <small>{{ [...draft.title].length }}/120</small></span>
          <input v-model="draft.title" name="calendar-title" class="yy-input" maxlength="120" placeholder="例如：专注学习、项目冲刺、休整" />
        </label>

        <div class="yy-calendar-field">
          <span>时间粒度</span>
          <div class="yy-calendar-segments wide" aria-label="状态时间粒度">
            <button v-for="item in grains" :key="item.value" type="button" :class="{ active: draft.precision === item.value }" @click="setDraftPrecision(item.value)">{{ item.label }}</button>
          </div>
        </div>

        <div class="yy-calendar-boundaries">
          <label class="yy-calendar-field">
            <span>开始</span>
            <input
              class="yy-input"
              :type="draft.precision === 'year' ? 'number' : draft.precision === 'month' ? 'month' : 'date'"
              :min="draft.precision === 'year' ? 1000 : draft.precision === 'month' ? '1000-01' : '1000-01-01'"
              :max="draft.precision === 'year' ? 9999 : draft.precision === 'month' ? '9999-12' : '9999-12-31'"
              :value="boundaryValue('start')"
              @input="changeBoundary('start', $event)"
            />
          </label>
          <label class="yy-calendar-field">
            <span>结束 <small>包含当天</small></span>
            <input
              class="yy-input"
              :type="draft.precision === 'year' ? 'number' : draft.precision === 'month' ? 'month' : 'date'"
              :min="draft.precision === 'year' ? 1000 : draft.precision === 'month' ? '1000-01' : '1000-01-01'"
              :max="draft.precision === 'year' ? 9999 : draft.precision === 'month' ? '9999-12' : '9999-12-31'"
              :value="boundaryValue('end')"
              @input="changeBoundary('end', $event)"
            />
          </label>
        </div>
        <p v-if="rangeError" class="yy-calendar-field-error">{{ rangeError }}</p>

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
          <textarea v-model="draft.note" class="yy-input yy-textarea" maxlength="2000" rows="5" placeholder="记录这一阶段的重点、感受或背景。"></textarea>
        </label>

        <div class="yy-calendar-inspector-actions">
          <button v-if="draft.id != null" type="button" class="yy-btn danger-text" @click="removeDraft"><Trash2 :size="15" />删除</button>
          <span class="yy-spacer"></span>
          <button type="button" class="yy-btn" @click="closeDraft()">取消</button>
          <button type="button" class="yy-btn primary" :disabled="!!rangeError" @click="saveDraft"><Save :size="15" />应用</button>
        </div>
        <p class="yy-calendar-shortcut">⌘/Ctrl + Enter 应用 · Esc 关闭</p>
      </aside>
    </section>
  </section>
  </Teleport>
</template>

<style scoped>
.yy-calendar-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
.yy-calendar-main, .yy-calendar-inspector { min-width: 0; border: 1px solid var(--yy-border); border-radius: 12px; background: var(--yy-bg); box-shadow: 0 5px 20px color-mix(in srgb, #000 4%, transparent); }
.yy-calendar-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 58px; padding: 10px 12px; border-bottom: 1px solid var(--yy-border); }
.yy-calendar-segments { display: inline-flex; flex: none; padding: 3px; border-radius: 8px; background: var(--yy-bg-muted); }
.yy-calendar-segments button { min-width: 40px; height: 28px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--yy-text-2); cursor: pointer; }
.yy-calendar-segments button.active { background: var(--yy-bg); color: var(--yy-text); box-shadow: 0 1px 4px #00000012; font-weight: 600; }
.yy-calendar-segments.wide { display: grid; grid-template-columns: repeat(3, 1fr); }
.yy-calendar-navigate { display: flex; align-items: center; margin-left: auto; }
.yy-calendar-window { width: 198px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
.yy-calendar-locate { display: flex; align-items: center; gap: 5px; height: 32px; padding: 0 8px; border: 1px solid var(--yy-border-strong); border-radius: var(--yy-radius); color: var(--yy-text-3); }
.yy-calendar-locate input { width: 118px; border: 0; outline: 0; background: transparent; color: var(--yy-text); font: inherit; }
.yy-calendar-frame { overflow: hidden; border-radius: 0 0 12px 12px; }
.yy-calendar-scroll { overflow: auto hidden; overscroll-behavior-x: contain; scrollbar-gutter: stable; }
.yy-calendar-timeline { position: relative; isolation: isolate; overflow: clip; touch-action: pan-x pan-y; user-select: none; cursor: crosshair; }
.yy-calendar-ruler, .yy-calendar-grid { display: grid; grid-template-columns: repeat(var(--calendar-columns), minmax(0, 1fr)); }
.yy-calendar-ruler { position: relative; z-index: 4; height: 58px; border-bottom: 1px solid var(--yy-border); background: var(--yy-bg-muted); }
.yy-calendar-cell { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; border-left: 1px solid var(--yy-border); color: var(--yy-text-3); font-size: 10px; line-height: 1.25; }
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
.yy-calendar-period { container-type: inline-size; --period: #00a66a; --period-soft: #dff7ed; position: absolute; z-index: 2; display: flex; align-items: center; min-width: 7px; height: 34px; padding: 0 10px; overflow: clip; border: 1px solid color-mix(in srgb, var(--period) 44%, transparent); border-radius: 7px; background: color-mix(in srgb, var(--period) 13%, var(--yy-bg)); color: color-mix(in srgb, var(--period) 70%, var(--yy-text)); box-shadow: 0 2px 5px #0000000d; cursor: grab; text-align: left; }
.yy-calendar-period:hover { z-index: 5; border-color: var(--period); box-shadow: 0 4px 12px #00000016; }
.yy-calendar-period:active { cursor: grabbing; }
.yy-calendar-period.selected { z-index: 4; border-color: var(--period); box-shadow: 0 0 0 2px color-mix(in srgb, var(--period) 24%, transparent), 0 4px 12px #00000016; }
.yy-calendar-period.clip-start { border-left-style: dashed; border-radius: 2px 7px 7px 2px; }
.yy-calendar-period.clip-end { border-right-style: dashed; border-radius: 7px 2px 2px 7px; }
.yy-calendar-period-text { position: sticky; left: 10px; display: flex; align-items: baseline; gap: 8px; min-width: 0; max-width: calc(100% - 12px); pointer-events: none; }
.yy-calendar-period-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
.yy-calendar-period-text small { flex: none; opacity: .72; font-size: 10px; font-variant-numeric: tabular-nums; }
.yy-calendar-resize { position: absolute; top: 5px; bottom: 5px; width: 8px; border-radius: 3px; cursor: ew-resize; }
.yy-calendar-resize.start { left: 2px; }
.yy-calendar-resize.end { right: 2px; }
.yy-calendar-period:hover .yy-calendar-resize::after, .yy-calendar-period.selected .yy-calendar-resize::after { content: ''; position: absolute; left: 3px; top: 5px; bottom: 5px; width: 2px; border-radius: 1px; background: var(--period); opacity: .55; }
.yy-calendar-selection { position: absolute; z-index: 1; top: 58px; bottom: 0; border: 1px dashed var(--yy-primary); background: color-mix(in srgb, var(--yy-primary-soft) 60%, transparent); pointer-events: none; }
.yy-calendar-selection span { position: absolute; top: 8px; left: 50%; padding: 2px 7px; border-radius: 10px; background: var(--yy-primary); color: #fff; font-size: 10px; white-space: nowrap; transform: translateX(-50%); }
.yy-calendar-empty { position: absolute; z-index: 1; left: 50%; top: 66%; display: flex; flex-direction: column; align-items: center; color: var(--yy-text-3); transform: translate(-50%, -50%); pointer-events: none; }
.yy-calendar-empty strong { margin-top: 5px; color: var(--yy-text-2); }
.yy-calendar-empty span { font-size: 12px; }
.yy-calendar-caption { display: flex; justify-content: space-between; gap: 20px; padding: 7px 12px 9px; border-top: 1px solid var(--yy-border); color: var(--yy-text-4); font-size: 10px; }
.yy-calendar-inspector { position: static; display: flex; flex-direction: column; padding: 16px; }
.yy-calendar-inspector-head { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 13px; border-bottom: 1px solid var(--yy-border); }
.yy-calendar-inspector-head > div { min-width: 0; }
.yy-calendar-inspector-head span, .yy-calendar-inspector-head small { display: block; }
.yy-calendar-inspector-head span { font-weight: 650; }
.yy-calendar-inspector-head small { margin-top: 2px; overflow: hidden; color: var(--yy-text-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.yy-calendar-field { display: flex; flex-direction: column; gap: 5px; margin-top: 14px; }
.yy-calendar-field > span { display: flex; justify-content: space-between; color: var(--yy-text-2); font-size: 12px; }
.yy-calendar-field > span small { color: var(--yy-text-4); font-weight: 400; }
.yy-calendar-boundaries { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
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
.yy-calendar-inspector-actions { display: flex; align-items: center; gap: 7px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--yy-border); }
.yy-calendar-shortcut { margin: 8px 0 -4px; color: var(--yy-text-4); font-size: 10px; text-align: right; }
@media (max-width: 650px) {
  .yy-calendar-main, .yy-calendar-inspector { border-radius: 10px; }
  .yy-calendar-toolbar { gap: 6px; padding: 9px; }
  .yy-calendar-navigate { order: 3; flex: 1 0 100%; justify-content: center; border-top: 1px solid var(--yy-border); padding-top: 5px; }
  .yy-calendar-window { flex: 1; }
  .yy-calendar-locate { flex: 1; min-width: 0; margin-left: 0; }
  .yy-calendar-locate input { width: 100%; min-width: 0; }
  .yy-calendar-caption { display: none; }
  .yy-calendar-inspector { padding: 14px; }
  .yy-calendar-boundaries { grid-template-columns: 1fr; gap: 0; }
  .yy-calendar-period-text small { display: none; }
  .yy-calendar-shortcut { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .yy-calendar-period { transition: none; }
}
.yy-calendar-panel { width: 100%; padding: 0; margin: 0; container-type: inline-size; font: 13px/1.5 var(--yy-font, sans-serif); color: var(--yy-text); }
.yy-calendar-block-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--yy-border); border-bottom: 0; border-radius: 12px 12px 0 0; background: var(--yy-bg); }
.yy-calendar-block-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.yy-calendar-block-head > .lucide { color: var(--yy-primary); flex: none; }
.yy-calendar-block-head > strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.yy-calendar-title { flex: 1; min-width: 60px; width: 0; padding: 4px 0; border: 0; background: transparent; color: var(--yy-text); font: inherit; font-weight: 650; }
.yy-calendar-block-count { color: var(--yy-text-3); font-size: 11px; white-space: nowrap; }
.yy-calendar-main { border-radius: 0 0 12px 12px; box-shadow: none; }
.yy-calendar-note { white-space: pre-wrap; overflow-wrap: anywhere; }
.readonly .yy-calendar-timeline, .readonly .yy-calendar-period { cursor: default; }
.yy-calendar-panel.expanded { position: fixed; z-index: 80; inset: 16px; width: auto; overflow: auto; padding: 20px; background: var(--yy-bg); border: 1px solid var(--yy-border); border-radius: 16px; box-shadow: 0 0 0 100vmax #0008; }
@container (max-width: 160px) {
  .yy-calendar-period-text small { display: none; }
}
@container (max-width: 680px) {
  .yy-calendar-navigate { order: 4; flex: 1 0 100%; justify-content: center; }
  .yy-calendar-window { flex: 1; }
  .yy-calendar-block-count { display: none; }
  .yy-calendar-locate { flex: 1; }
  .yy-calendar-caption { display: none; }
}
@container (min-width: 980px) {
  .yy-calendar-workspace.has-inspector { grid-template-columns: minmax(0, 1fr) 300px; }
}
</style>
