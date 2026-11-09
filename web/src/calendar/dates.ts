import type { CalendarDisplayRange, CalendarEntry, CalendarPrecision } from '../schema/calendar'

export interface CalendarCell {
  start: string
  end: string
  primary: string
  secondary: string
  current: boolean
  weekend: boolean
  boundary: boolean
  weight: number
}

export interface PeriodGeometry {
  left: number
  width: number
  clippedStart: boolean
  clippedEnd: boolean
}

const DAY = 86_400_000
const WEEKEND_WEIGHT = .18

export function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('invalid calendar date')
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (formatCalendarDate(date) !== value) throw new Error('invalid calendar date')
  return date
}

export function formatCalendarDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function todayDate(): string {
  const now = new Date()
  const local = new Date(0)
  local.setUTCHours(0, 0, 0, 0)
  local.setUTCFullYear(now.getFullYear(), now.getMonth(), now.getDate())
  return formatCalendarDate(local)
}

export function addDays(value: string, days: number): string {
  const date = parseCalendarDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return formatCalendarDate(date)
}

export function unitBounds(value: string, grain: CalendarPrecision): { start: string; end: string } {
  const date = parseCalendarDate(value)
  if (grain === 'year') {
    const year = date.getUTCFullYear()
    return { start: `${String(year).padStart(4, '0')}-01-01`, end: `${String(year).padStart(4, '0')}-12-31` }
  }
  if (grain === 'month') {
    const start = new Date(0)
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth(), 1)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1, 0)
    return { start: formatCalendarDate(start), end: formatCalendarDate(end) }
  }
  const exact = formatCalendarDate(date)
  return { start: exact, end: exact }
}

export function addUnits(value: string, grain: CalendarPrecision, amount: number): string {
  const date = parseCalendarDate(unitBounds(value, grain).start)
  if (grain === 'year') date.setUTCFullYear(date.getUTCFullYear() + amount)
  else if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + amount)
  else date.setUTCDate(date.getUTCDate() + amount)
  return formatCalendarDate(date)
}

export function windowCells(center: string, grain: CalendarPrecision, count = 96, range?: CalendarDisplayRange | null, workdaysOnly = false): CalendarCell[] {
  const first = unitBounds(range?.startDate ?? '1000-01-01', grain).start
  const last = unitBounds(range?.endDate ?? '9999-12-31', grain).end
  const span = periodSpan({ startDate: first, endDate: last }, grain)
  count = Math.min(count, Math.round(span.end - span.start))
  const before = Math.floor(count / 2)
  const latestStart = addUnits(last, grain, 1 - count)
  const start = [addUnits(center, grain, -before), first, latestStart].sort()[1]!
  const today = todayDate()
  const cells: CalendarCell[] = []
  for (let index = 0; index < count; index++) {
    const value = addUnits(start, grain, index)
    if (value.length > 10 || value > last) break
    const bounds = unitBounds(value, grain)
    const date = parseCalendarDate(bounds.start)
    let primary = ''
    let secondary = ''
    if (grain === 'year') primary = `${date.getUTCFullYear()}`
    else if (grain === 'month') {
      primary = `${date.getUTCMonth() + 1}月`
      secondary = `${date.getUTCFullYear()}`
    } else {
      primary = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
      secondary = ['日', '一', '二', '三', '四', '五', '六'][date.getUTCDay()]
    }
    const weekend = grain === 'day' && (date.getUTCDay() === 0 || date.getUTCDay() === 6)
    cells.push({
      ...bounds,
      primary,
      secondary,
      current: today >= bounds.start && today <= bounds.end,
      weekend,
      boundary: grain === 'year' || (grain === 'month' ? date.getUTCMonth() === 0 : date.getUTCDate() === 1),
      weight: workdaysOnly && weekend ? WEEKEND_WEIGHT : 1,
    })
  }
  return cells
}

export function axisLength(cells: CalendarCell[]): number {
  return cells.reduce((length, cell) => length + cell.weight, 0)
}

export function dayPosition(value: string, cells: CalendarCell[]): number {
  if (!cells.length || value <= cells[0].start) return 0
  let position = 0
  for (const cell of cells) {
    if (value > cell.end) { position += cell.weight; continue }
    const cellStart = parseCalendarDate(cell.start).getTime()
    const span = ((parseCalendarDate(cell.end).getTime() + DAY) - cellStart) / DAY
    const offset = (parseCalendarDate(value).getTime() - cellStart) / DAY
    return position + offset / span * cell.weight
  }
  return position
}

export function dateAtPosition(position: number, cells: CalendarCell[]): string {
  const cell = cells.find((cell, index) => {
    if (position < cell.weight - 1e-9 || index === cells.length - 1) return true
    position -= cell.weight
    return false
  }) ?? cells.at(-1)!
  const days = (parseCalendarDate(cell.end).getTime() - parseCalendarDate(cell.start).getTime()) / DAY + 1
  return addDays(cell.start, Math.min(days - 1, Math.max(0, Math.floor(position / cell.weight * days))))
}

export function periodDays(period: Pick<CalendarEntry, 'startDate' | 'endDate'>, workdaysOnly = false): number {
  const start = parseCalendarDate(period.startDate)
  const days = (parseCalendarDate(period.endDate).getTime() - start.getTime()) / DAY + 1
  if (!workdaysOnly) return days
  let count = Math.floor(days / 7) * 5
  for (let offset = 0; offset < days % 7; offset++) {
    const weekday = (start.getUTCDay() + offset) % 7
    if (weekday !== 0 && weekday !== 6) count++
  }
  return count
}

export function periodDaysLabel(period: Pick<CalendarEntry, 'startDate' | 'endDate'>, workdaysOnly = false): string {
  return `${periodDays(period, workdaysOnly)} ${workdaysOnly ? '个工作日' : '天'}`
}

// Shift exact dates without JavaScript's end-of-month overflow (Jan 31 -> Feb 28).
function shiftDate(value: string, grain: CalendarPrecision, amount: number): string {
  if (grain === 'day') return addDays(value, amount)
  const day = parseCalendarDate(value).getUTCDate()
  const start = addUnits(value, grain === 'year' ? 'month' : grain, grain === 'year' ? amount * 12 : amount)
  if (start < '1000-01-01' || start > '9999-12-31' || start.length !== 10) return start
  return addDays(start, Math.min(day, parseCalendarDate(unitBounds(start, 'month').end).getUTCDate()) - 1)
}

export function adjustPeriod(period: CalendarEntry, grain: CalendarPrecision, amount: number, mode: 'move' | 'start' | 'end'): CalendarEntry {
  if (!amount) return { ...period }
  const shiftedStart = shiftDate(period.startDate, grain, amount)
  const shiftedEnd = shiftDate(period.endDate, grain, amount)
  if ([shiftedStart, shiftedEnd].some(date => date.length !== 10 || date < '1000-01-01' || date > '9999-12-31')) return { ...period }
  let startDate = period.startDate, endDate = period.endDate
  if (mode === 'move') {
    startDate = unitBounds(shiftedStart, period.precision).start
    if (period.precision === 'day') endDate = addDays(startDate, periodDays(period) - 1)
    else {
      const start = parseCalendarDate(period.startDate), next = parseCalendarDate(startDate)
      const units = period.precision === 'year' ? next.getUTCFullYear() - start.getUTCFullYear()
        : (next.getUTCFullYear() - start.getUTCFullYear()) * 12 + next.getUTCMonth() - start.getUTCMonth()
      const last = addUnits(period.endDate, period.precision, units)
      if (last.length !== 10 || last > '9999-12-31') return { ...period }
      endDate = unitBounds(last, period.precision).end
    }
  } else if (mode === 'start') startDate = unitBounds(shiftedStart, period.precision).start
  else endDate = unitBounds(shiftedEnd, period.precision).end
  if (startDate > endDate || endDate > '9999-12-31' || endDate.length !== 10) return { ...period }
  return { ...period, startDate, endDate }
}

// Narrowest bar, as a percentage of the rendered axis, so a short range stays visible and clickable.
export const minPeriodWidth = 0.18

export function periodGeometry(period: Pick<CalendarEntry, 'startDate' | 'endDate'>, cells: CalendarCell[]): PeriodGeometry | null {
  if (!cells.length || period.endDate < cells[0].start || period.startDate > cells.at(-1)!.end) return null
  const length = axisLength(cells)
  const start = dayPosition(period.startDate, cells)
  const end = period.endDate >= cells.at(-1)!.end ? length : dayPosition(addDays(period.endDate, 1), cells)
  return {
    left: start / length * 100,
    width: Math.max(minPeriodWidth, (end - start) / length * 100),
    clippedStart: period.startDate < cells[0].start,
    clippedEnd: period.endDate > cells.at(-1)!.end,
  }
}

// Absolute position of a day's start (or end) in grain units, independent of the rendered cell
// window, so pixel-based layout stays stable while the axis is recycled.
function dayEdge(value: string, grain: CalendarPrecision, after: boolean, workdaysOnly: boolean): number {
  const date = parseCalendarDate(value)
  const day = date.getTime() / DAY + (after ? 1 : 0)
  if (grain === 'day') {
    if (!workdaysOnly) return day
    // Monday-based weeks also cover pre-epoch dates; retain a narrow, reversible weekend span.
    const weeks = Math.floor((day + 3) / 7)
    const weekday = day + 3 - weeks * 7
    return weeks * (5 + 2 * WEEKEND_WEIGHT) + Math.min(weekday, 5) + Math.max(0, weekday - 5) * WEEKEND_WEIGHT
  }
  const bounds = unitBounds(value, grain)
  const start = parseCalendarDate(bounds.start).getTime() / DAY
  const span = parseCalendarDate(bounds.end).getTime() / DAY + 1 - start
  const unit = grain === 'year' ? date.getUTCFullYear() : date.getUTCFullYear() * 12 + date.getUTCMonth()
  return unit + (day - start) / span
}

export function periodSpan(period: Pick<CalendarEntry, 'startDate' | 'endDate'>, grain: CalendarPrecision, workdaysOnly = false): { start: number; end: number } {
  return { start: dayEdge(period.startDate, grain, false, workdaysOnly), end: dayEdge(period.endDate, grain, true, workdaysOnly) }
}

// Packs by occupied extent; the default is the date range itself, callers may widen the end
// (for example by a label drawn beside the bar).
export function assignPeriodLanes<T extends Pick<CalendarEntry, 'id' | 'startDate' | 'endDate'>>(
  periods: T[], extent: (period: T) => { start: number; end: number } = period => periodSpan(period, 'day'),
): { lanes: Map<number, number>; count: number } {
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id - b.id)
  const ends: number[] = []
  const lanes = new Map<number, number>()
  for (const period of sorted) {
    const span = extent(period)
    let lane = ends.findIndex((end) => end <= span.start)
    if (lane < 0) lane = ends.length
    ends[lane] = span.end
    lanes.set(period.id, lane)
  }
  return { lanes, count: ends.length }
}

export function periodDurationLabel(period: Pick<CalendarEntry, 'startDate' | 'endDate' | 'precision'>, workdaysOnly = false): string {
  if (period.precision === 'day') return periodDaysLabel(period, workdaysOnly)
  const start = parseCalendarDate(period.startDate), end = parseCalendarDate(period.endDate)
  const years = end.getUTCFullYear() - start.getUTCFullYear()
  if (period.precision === 'year') return `${years + 1} 年`
  return `${years * 12 + end.getUTCMonth() - start.getUTCMonth() + 1} 个月`
}

export function periodRangeLabel(period: Pick<CalendarEntry, 'startDate' | 'endDate' | 'precision'>): string {
  if (period.precision === 'year') return period.startDate.slice(0, 4) === period.endDate.slice(0, 4)
    ? `${period.startDate.slice(0, 4)}年`
    : `${period.startDate.slice(0, 4)}年 – ${period.endDate.slice(0, 4)}年`
  if (period.precision === 'month') {
    const startDate = parseCalendarDate(period.startDate)
    const endDate = parseCalendarDate(period.endDate)
    const start = `${startDate.getUTCFullYear()}年${startDate.getUTCMonth() + 1}月`
    const end = `${endDate.getUTCFullYear()}年${endDate.getUTCMonth() + 1}月`
    return start === end ? start : `${start} – ${end}`
  }
  return period.startDate === period.endDate ? period.startDate : `${period.startDate} – ${period.endDate}`
}

export function canonicalRange(start: string, end: string, grain: CalendarPrecision): { startDate: string; endDate: string } {
  const first = start <= end ? start : end
  const last = start <= end ? end : start
  return { startDate: unitBounds(first, grain).start, endDate: unitBounds(last, grain).end }
}
