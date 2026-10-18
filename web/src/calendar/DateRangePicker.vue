<script setup lang="ts">
import { computed, shallowRef, ref, watch } from 'vue'
import { CalendarDate, parseDate, type DateValue } from '@internationalized/date'
import { CalendarRoot, CalendarGrid, CalendarGridHead, CalendarGridBody, CalendarGridRow, CalendarHeadCell, CalendarCell, CalendarCellTrigger } from 'reka-ui'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import IconButton from '../ui/IconButton.vue'
import { todayDate, unitBounds } from './dates'
import type { CalendarPrecision } from '../schema/calendar'

const props = defineProps<{ start: string; end: string; precision: CalendarPrecision; side: 'start' | 'end'; selectingEnd: boolean }>()
const emit = defineEmits<{ select: [date: string]; close: [] }>()
type View = 'day' | 'month' | 'year'
const view = ref<View>(props.precision)
const placeholder = shallowRef<DateValue>(parseDate(props.side === 'start' ? props.start : props.end))
const hovered = ref('')
const yearText = ref(String(placeholder.value.year))
const yearError = ref(false)
const min = new CalendarDate(1000, 1, 1), max = new CalendarDate(9999, 12, 31)
const selected = computed(() => parseDate(props.side === 'start' || props.selectingEnd ? props.start : props.end))
const yearBase = computed(() => 1000 + Math.floor((placeholder.value.year - 1000) / 12) * 12)
const years = computed(() => Array.from({ length: 12 }, (_, i) => yearBase.value + i))
const months = computed(() => Array.from({ length: 12 }, (_, i) => new CalendarDate(placeholder.value.year, i + 1, 1)))
const today = todayDate()
watch(() => [props.side, props.precision], () => {
  view.value = props.precision
  hovered.value = ''
  if (!props.selectingEnd) placeholder.value = parseDate(props.side === 'start' ? props.start : props.end)
})
watch(placeholder, date => { yearText.value = String(date.year); yearError.value = false; hovered.value = '' })
const pageLabel = computed(() => view.value === 'day' ? `${placeholder.value.year}年 ${placeholder.value.month}月` : view.value === 'month' ? `${placeholder.value.year}年` : `${yearBase.value}–${yearBase.value + 11}年`)
const canPrev = computed(() => view.value === 'day' ? placeholder.value.year > 1000 || placeholder.value.month > 1 : view.value === 'month' ? placeholder.value.year > 1000 : yearBase.value > 1000)
const canNext = computed(() => view.value === 'day' ? placeholder.value.year < 9999 || placeholder.value.month < 12 : view.value === 'month' ? placeholder.value.year < 9999 : yearBase.value + 11 < 9999)
function move(amount: number) {
  if (view.value === 'day') placeholder.value = placeholder.value.set({ day: 1 }).add({ months: amount })
  else if (view.value === 'month') placeholder.value = placeholder.value.add({ years: amount })
  else placeholder.value = placeholder.value.set({ year: Math.max(1000, Math.min(9999, yearBase.value + amount * 12)) })
}
function jumpYear() {
  const year = Number(yearText.value)
  if (!/^\d{4}$/.test(yearText.value) || year < 1000 || year > 9999) { yearError.value = true; return }
  placeholder.value = placeholder.value.set({ year })
}
function chooseYear(year: number) {
  if (props.precision === 'year') emit('select', `${year}-01-01`)
  else { placeholder.value = placeholder.value.set({ year, day: 1 }); view.value = 'month' }
}
function chooseMonth(date: DateValue) {
  if (props.precision === 'month') emit('select', date.toString())
  else { placeholder.value = date; view.value = 'day' }
}
function selectDay(date: DateValue | undefined) {
  if (date) emit('select', date.toString())
}
function dateClasses(date: string, precision: CalendarPrecision = props.precision) {
  if (date < '1000-01-01' || date > '9999-12-31' || date.length !== 10) return {}
  const bounds = unitBounds(date, precision)
  const preview = props.selectingEnd && hovered.value
  const a = props.start, b = preview ? hovered.value : props.end
  const start = unitBounds(a < b ? a : b, props.precision).start
  const end = unitBounds(a < b ? b : a, props.precision).end
  return {
    'in-range': bounds.start <= end && bounds.end >= start,
    'range-start': bounds.start <= start && bounds.end >= start,
    'range-end': bounds.start <= end && bounds.end >= end,
    today: bounds.start <= today && bounds.end >= today,
  }
}
function hover(date: string) { if (props.selectingEnd) hovered.value = date }
function thisPage() { placeholder.value = parseDate(today); view.value = props.precision }
function yearKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) { event.preventDefault(); event.stopPropagation(); jumpYear() }
}
</script>

<template>
  <div class="yy-date-picker">
    <div class="yy-date-picker-head"><span>{{ side === 'start' ? '选择开始日期' : '选择结束日期' }}</span><IconButton label="收起日期面板" @click="emit('close')"><X :size="15" /></IconButton></div>
    <div class="yy-date-nav">
      <IconButton :label="view === 'day' ? '上个月' : view === 'month' ? '上一年' : '前十二年'" :disabled="!canPrev" @click="move(-1)"><ChevronLeft :size="17" /></IconButton>
      <button type="button" class="yy-date-heading" :data-tip="view === 'day' ? '选择月份' : view === 'month' ? '选择年份' : undefined" @click="view = view === 'day' ? 'month' : 'year'">{{ pageLabel }}</button>
      <IconButton :label="view === 'day' ? '下个月' : view === 'month' ? '下一年' : '后十二年'" :disabled="!canNext" @click="move(1)"><ChevronRight :size="17" /></IconButton>
    </div>
    <div class="yy-date-jump"><label><span>年份</span><input v-model="yearText" aria-label="跳转年份" inputmode="numeric" maxlength="4" :aria-invalid="yearError" @change="jumpYear" @keydown="yearKey" /></label><button type="button" @click="jumpYear">跳转</button><span class="yy-spacer"></span><button type="button" @click="thisPage">回到{{ precision === 'year' ? '今年' : '本月' }}</button></div>
    <CalendarRoot v-if="view === 'day'" v-slot="{ grid, weekDays }" v-model:placeholder="placeholder" :model-value="selected" :min-value="min" :max-value="max" :week-starts-on="1" locale="zh-CN" fixed-weeks prevent-deselect class="yy-date-days" @update:model-value="selectDay">
      <CalendarGrid v-for="month in grid" :key="month.value.toString()" as="div" class="yy-date-grid" @mouseleave="hovered = ''">
        <CalendarGridHead as="div"><CalendarGridRow as="div" class="yy-date-week"><CalendarHeadCell v-for="(day, i) in weekDays" :key="i" as="div" role="columnheader">{{ day }}</CalendarHeadCell></CalendarGridRow></CalendarGridHead>
        <CalendarGridBody as="div"><CalendarGridRow v-for="(week, i) in month.rows" :key="i" as="div" class="yy-date-week"><CalendarCell v-for="date in week" :key="date.toString()" as="div" :date="date" class="yy-date-cell"><CalendarCellTrigger as="button" type="button" :day="date" :month="month.value" class="yy-date-day" :class="dateClasses(date.toString(), 'day')" @mouseenter="hover(date.toString())" /></CalendarCell></CalendarGridRow></CalendarGridBody>
      </CalendarGrid>
    </CalendarRoot>
    <div v-else-if="view === 'month'" class="yy-date-units" @mouseleave="hovered = ''"><button v-for="date in months" :key="date.month" type="button" :aria-label="`${date.year}年${date.month}月`" :class="precision === 'month' ? dateClasses(date.toString(), 'month') : {}" @mouseenter="hover(date.toString())" @click="chooseMonth(date)">{{ date.month }}月</button></div>
    <div v-else class="yy-date-units" @mouseleave="hovered = ''"><button v-for="year in years" :key="year" type="button" :aria-label="`${year}年`" :class="precision === 'year' ? dateClasses(`${year}-01-01`, 'year') : {}" @mouseenter="hover(`${year}-01-01`)" @click="chooseYear(year)">{{ year }}</button></div>
    <div class="yy-date-picker-foot">{{ yearError ? '请输入 1000–9999 之间的年份' : selectingEnd ? '再选结束日期，也可以选同一天' : view === precision ? '点击日期选择，可直接输入或跳转年月' : view === 'year' ? '选择年份后，再选择月份' : '选择月份后，再选择日期' }}</div>
  </div>
</template>

<style scoped>
.yy-date-picker { padding: 8px 12px 10px; font-size: 12px; }
.yy-date-picker-head { display: flex; align-items: center; justify-content: space-between; color: var(--yy-text-3); font-size: 11px; }
.yy-date-picker-head :deep(.yy-icon-btn) { width: 26px; height: 26px; }
.yy-date-nav { display: flex; justify-content: space-between; align-items: center; margin: 3px 0 8px; }
.yy-date-heading { padding: 5px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--yy-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.yy-date-heading:hover { background: var(--yy-bg-hover); }
.yy-date-jump { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; padding: 0 3px; color: var(--yy-text-3); font-size: 10px; }
.yy-date-jump label { display: flex; align-items: center; gap: 6px; }
.yy-date-jump input { width: 52px; padding: 3px 4px; border: 1px solid var(--yy-border); border-radius: 4px; background: var(--yy-bg); color: var(--yy-text-2); font: inherit; font-variant-numeric: tabular-nums; text-align: center; }
.yy-date-jump input[aria-invalid="true"] { border-color: var(--yy-danger); }
.yy-date-jump button { padding: 4px; border: 0; background: transparent; color: var(--yy-primary); font: inherit; cursor: pointer; }
.yy-date-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.yy-date-week > [role="columnheader"] { padding: 4px 0 8px; color: var(--yy-text-4); font-size: 10px; text-align: center; }
.yy-date-cell { min-width: 0; padding: 2px 0; }
.yy-date-day { position: relative; display: grid; place-items: center; width: 100%; height: 30px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--yy-text-2); font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
.yy-date-day[data-outside-view] { color: var(--yy-text-4); }
.yy-date-day[data-disabled] { opacity: .3; cursor: default; pointer-events: none; }
.yy-date-day.in-range { border-radius: 0; background: var(--yy-primary-soft); color: var(--yy-primary); }
.yy-date-day.range-start { border-radius: 6px 0 0 6px; }
.yy-date-day.range-end { border-radius: 0 6px 6px 0; }
.yy-date-day.range-start.range-end { border-radius: 6px; }
.yy-date-day.range-start, .yy-date-day.range-end { background: var(--yy-primary); color: white; font-weight: 650; }
.yy-date-day.today::after { content: ''; position: absolute; bottom: 3px; left: calc(50% - 1.5px); width: 3px; height: 3px; border-radius: 50%; background: currentColor; }
.yy-date-day:hover { background: var(--yy-bg-hover); }
.yy-date-day.in-range:hover { background: color-mix(in srgb, var(--yy-primary) 18%, var(--yy-bg)); }
.yy-date-day.range-start:hover, .yy-date-day.range-end:hover { background: var(--yy-primary); }
.yy-date-units { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding: 6px 0; min-height: 234px; }
.yy-date-units button { border: 0; border-radius: 7px; background: transparent; color: var(--yy-text-2); font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
.yy-date-units button:hover { background: var(--yy-bg-hover); }
.yy-date-units button.in-range { background: var(--yy-primary-soft); color: var(--yy-primary); }
.yy-date-units button.range-start, .yy-date-units button.range-end { background: var(--yy-primary); color: white; font-weight: 600; }
.yy-date-units button.today { text-decoration: underline; text-underline-offset: 5px; }
.yy-date-picker-foot { min-height: 20px; padding: 5px 2px 0; color: var(--yy-text-4); font-size: 10px; }
</style>
