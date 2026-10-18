<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, CalendarDays } from 'lucide-vue-next'
import { deferred } from '../shared/deferred'
import { canonicalRange, parseCalendarDate, periodDays, todayDate, unitBounds } from './dates'
import type { CalendarPrecision } from '../schema/calendar'

const picker = deferred(() => import('./DateRangePicker.vue'))
const props = defineProps<{ start: string; end: string; precision: CalendarPrecision }>()
const emit = defineEmits<{
  change: [value: { startDate: string; endDate: string; precision: CalendarPrecision }]
  invalid: [message: string]
}>()
const field = ref<HTMLElement>()
const open = ref(false)
const side = ref<'start' | 'end'>('start')
const startText = ref('')
const endText = ref('')
const loadError = ref(false)
const selectingEnd = ref(false)
let anchor = ''
let disposed = false
let typing = false
const precisions: { value: CalendarPrecision; label: string }[] = [
  { value: 'day', label: '按日' }, { value: 'month', label: '按月' }, { value: 'year', label: '按年' },
]
function format(value: string, precision = props.precision) {
  return precision === 'year' ? value.slice(0, 4) : precision === 'month' ? value.slice(0, 7) : value
}
watch(() => [props.start, props.end, props.precision], () => {
  if (typing) { typing = false; return }
  startText.value = format(props.start)
  endText.value = format(props.end)
}, { immediate: true })
function parse(value: string, endpoint: 'start' | 'end') {
  const text = value.trim().replace(/[/.]/g, '-')
  const pattern = props.precision === 'year' ? /^\d{4}$/ : props.precision === 'month' ? /^\d{4}-\d{1,2}$/ : /^\d{4}-\d{1,2}-\d{1,2}$/
  if (!pattern.test(text)) throw new Error('请输入有效日期')
  const parts = text.split('-').map(part => part.padStart(2, '0'))
  const date = [...parts, ...Array(3 - parts.length).fill('01')].join('-')
  try { parseCalendarDate(date) } catch { throw new Error('请输入有效日期') }
  if (date < '1000-01-01' || date > '9999-12-31') throw new Error('日期年份需在 1000–9999 之间')
  const bounds = unitBounds(date, props.precision)
  return endpoint === 'start' ? bounds.start : bounds.end
}
const parsed = computed(() => {
  try {
    const startDate = parse(startText.value, 'start'), endDate = parse(endText.value, 'end')
    if (startDate > endDate) return { error: '结束日期不能早于开始日期' }
    return { startDate, endDate, error: '' }
  } catch (error) { return { error: (error as Error).message } }
})
watch(() => parsed.value.error, message => emit('invalid', message), { immediate: true })
const duration = computed(() => {
  if (parsed.value.error) return ''
  if (props.precision === 'year') return `${Number(props.end.slice(0, 4)) - Number(props.start.slice(0, 4)) + 1} 年`
  if (props.precision === 'month') return `${(Number(props.end.slice(0, 4)) - Number(props.start.slice(0, 4))) * 12 + Number(props.end.slice(5, 7)) - Number(props.start.slice(5, 7)) + 1} 个月`
  return `${periodDays({ startDate: props.start, endDate: props.end })} 天`
})
function inputDate() {
  selectingEnd.value = false
  const value = parsed.value
  if (value.startDate && value.endDate && !value.error) {
    typing = value.startDate !== props.start || value.endDate !== props.end
    emit('change', { startDate: value.startDate, endDate: value.endDate, precision: props.precision })
  }
}
function normalizeInput() {
  const value = parsed.value
  if (value.startDate && value.endDate && !value.error) {
    startText.value = format(value.startDate)
    endText.value = format(value.endDate)
  }
}
function updateRange(startDate: string, endDate: string, precision = props.precision) {
  typing = false
  emit('change', { startDate, endDate, precision })
  startText.value = format(startDate, precision)
  endText.value = format(endDate, precision)
}
async function show(endpoint: 'start' | 'end') {
  side.value = endpoint
  selectingEnd.value = false
  open.value = true
  loadError.value = false
  try { await picker.load() } catch { if (!disposed) loadError.value = true }
}
function close(restoreFocus = true) {
  open.value = false
  selectingEnd.value = false
  if (restoreFocus) void nextTick(() => { if (!disposed) field.value?.querySelector<HTMLButtonElement>('.yy-date-toggle')?.focus({ preventScroll: true }) })
}
function setPrecision(precision: CalendarPrecision) {
  if (precision === props.precision) return
  close()
  const range = canonicalRange(props.start, props.end, precision)
  updateRange(range.startDate, range.endDate, precision)
  void nextTick(() => show('start'))
}
function select(date: string) {
  const bounds = unitBounds(date, props.precision)
  if (side.value === 'start') {
    anchor = bounds.start
    updateRange(bounds.start, props.end < bounds.start ? bounds.end : props.end)
    side.value = 'end'
    selectingEnd.value = true
  } else {
    const start = selectingEnd.value ? anchor : props.start
    const range = canonicalRange(start < date ? start : date, start < date ? date : start, props.precision)
    updateRange(range.startDate, range.endDate)
    close()
  }
}
function useToday() {
  const range = unitBounds(todayDate(), props.precision)
  updateRange(range.start, range.end)
  close()
}
function onKey(event: KeyboardEvent) {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'Escape' && open.value) { event.preventDefault(); event.stopPropagation(); close() }
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
    event.preventDefault(); event.stopPropagation()
    inputDate()
    normalizeInput()
    if (!parsed.value.error) {
      if (side.value === 'start') {
        void show('end')
        field.value?.querySelector<HTMLInputElement>('[aria-label="结束日期"]')?.focus({ preventScroll: true })
      } else close()
    }
  }
}
function outside(event: PointerEvent) {
  if (open.value && !field.value?.contains(event.target as Node)) close(false)
}
watch(open, value => {
  if (value) document.addEventListener('pointerdown', outside, true)
  else document.removeEventListener('pointerdown', outside, true)
})
onBeforeUnmount(() => { disposed = true; document.removeEventListener('pointerdown', outside, true); emit('invalid', '') })
</script>

<template>
  <div ref="field" class="yy-date-field" @keydown="onKey">
    <div class="yy-date-label"><span>日期范围</span><div class="yy-date-precision" aria-label="事件时间粒度"><button v-for="item in precisions" :key="item.value" type="button" :aria-pressed="precision === item.value" @click="setPrecision(item.value)">{{ item.label }}</button></div></div>
    <div class="yy-date-range" :class="{ invalid: parsed.error }">
      <label :class="{ active: open && side === 'start' }"><span>开始</span><input v-model="startText" aria-label="开始日期" inputmode="numeric" spellcheck="false" :placeholder="precision === 'day' ? 'YYYY-MM-DD' : precision === 'month' ? 'YYYY-MM' : 'YYYY'" @click="show('start')" @input="inputDate" @blur="normalizeInput" /></label>
      <ArrowRight :size="15" />
      <label :class="{ active: open && side === 'end' }"><span>结束</span><input v-model="endText" aria-label="结束日期" inputmode="numeric" spellcheck="false" :placeholder="precision === 'day' ? 'YYYY-MM-DD' : precision === 'month' ? 'YYYY-MM' : 'YYYY'" @click="show('end')" @input="inputDate" @blur="normalizeInput" /></label>
      <button type="button" class="yy-date-toggle" aria-label="选择日期范围" :aria-expanded="open" @click="open ? close() : show('start')"><CalendarDays :size="18" /></button>
    </div>
    <div class="yy-date-summary"><span>{{ parsed.error || `共 ${duration}，包含起止${precision === 'day' ? '当天' : precision === 'month' ? '月份' : '年份'}` }}</span><button type="button" @click="useToday">{{ precision === 'day' ? '今天' : precision === 'month' ? '本月' : '今年' }}</button></div>
    <div v-if="open" class="yy-date-popover">
      <component :is="picker.module.value.default" v-if="picker.module.value" :start="start" :end="end" :precision="precision" :side="side" :selecting-end="selectingEnd" @select="select" @close="close" />
      <div v-else class="yy-date-loading">{{ loadError ? '日期面板未能加载' : '正在加载日历…' }}<button v-if="loadError" type="button" @click="show(side)">重试</button></div>
    </div>
  </div>
</template>

<style scoped>
.yy-date-field { margin-top: 16px; }
.yy-date-label { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; color: var(--yy-text-2); font-size: 12px; }
.yy-date-precision { display: flex; gap: 2px; padding: 2px; border-radius: 7px; background: var(--yy-bg-muted); }
.yy-date-precision button { border: 0; border-radius: 5px; padding: 3px 9px; background: transparent; color: var(--yy-text-3); font: inherit; font-size: 11px; cursor: pointer; }
.yy-date-precision button[aria-pressed="true"] { color: var(--yy-primary); background: var(--yy-bg); font-weight: 600; }
.yy-date-range { display: flex; align-items: center; gap: 8px; border: 1px solid var(--yy-border); border-radius: 9px; padding: 4px; }
.yy-date-range.invalid { border-color: var(--yy-danger); }
.yy-date-range > label { display: flex; flex-direction: column; flex: 1; min-width: 0; padding: 6px 9px; border-radius: 6px; }
.yy-date-range > label.active { background: var(--yy-primary-soft); }
.yy-date-range label span { color: var(--yy-text-3); font-size: 10px; }
.yy-date-range input { width: 100%; min-width: 0; padding: 2px 0 0; border: 0; background: transparent; font: inherit; font-size: 13px; color: var(--yy-text); font-variant-numeric: tabular-nums; }
.yy-date-range > .lucide { flex: none; color: var(--yy-text-4); }
.yy-date-toggle { display: grid; place-items: center; flex: none; width: 32px; height: 36px; border: 0; border-radius: 6px; background: transparent; color: var(--yy-text-3); cursor: pointer; }
.yy-date-toggle:hover { background: var(--yy-bg-hover); color: var(--yy-primary); }
.yy-date-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; color: var(--yy-text-3); font-size: 10px; }
.yy-date-summary button { padding: 2px 4px; border: 0; background: transparent; color: var(--yy-primary); font: inherit; cursor: pointer; }
.yy-date-popover { margin-top: 8px; border: 1px solid var(--yy-border); border-radius: 10px; overflow: hidden; background: var(--yy-bg); }
.yy-date-loading { display: flex; align-items: center; justify-content: center; gap: 12px; height: 280px; color: var(--yy-text-3); font-size: 12px; }
.yy-date-loading button { border: 0; background: transparent; color: var(--yy-primary); cursor: pointer; }
</style>
