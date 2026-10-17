import type { CalendarPeriod, CalendarPrecision } from '../shared/api'

export interface CalendarCell {
  start: string
  end: string
  primary: string
  secondary: string
  current: boolean
  weekend: boolean
  boundary: boolean
}

export interface PeriodGeometry {
  left: number
  width: number
  clippedStart: boolean
  clippedEnd: boolean
}

const DAY = 86_400_000

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

export function windowCells(center: string, grain: CalendarPrecision): CalendarCell[] {
  const count = grain === 'year' ? 12 : grain === 'month' ? 18 : 42
  const before = grain === 'year' ? 5 : grain === 'month' ? 8 : 20
  const start = addUnits(center, grain, -before)
  const today = todayDate()
  const cells: CalendarCell[] = []
  for (let index = 0; index < count; index++) {
    const value = addUnits(start, grain, index)
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
    cells.push({
      ...bounds,
      primary,
      secondary,
      current: today >= bounds.start && today <= bounds.end,
      weekend: grain === 'day' && (date.getUTCDay() === 0 || date.getUTCDay() === 6),
      boundary: grain === 'year' || (grain === 'month' ? date.getUTCMonth() === 0 : date.getUTCDate() === 1),
    })
  }
  return cells
}

function dayPosition(value: string, cells: CalendarCell[]): number {
  if (!cells.length || value <= cells[0].start) return 0
  const last = cells.at(-1)!
  if (value > last.end) return cells.length
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]
    if (value > cell.end) continue
    const cellStart = parseCalendarDate(cell.start).getTime()
    const span = (parseCalendarDate(addDays(cell.end, 1)).getTime() - cellStart) / DAY
    const offset = (parseCalendarDate(value).getTime() - cellStart) / DAY
    return index + offset / span
  }
  return cells.length
}

export function periodGeometry(period: Pick<CalendarPeriod, 'startDate' | 'endDate'>, cells: CalendarCell[]): PeriodGeometry | null {
  if (!cells.length || period.endDate < cells[0].start || period.startDate > cells.at(-1)!.end) return null
  const start = dayPosition(period.startDate, cells)
  const end = dayPosition(addDays(period.endDate, 1), cells)
  return {
    left: start / cells.length * 100,
    width: Math.max(0.18, (end - start) / cells.length * 100),
    clippedStart: period.startDate < cells[0].start,
    clippedEnd: period.endDate > cells.at(-1)!.end,
  }
}

export function assignPeriodLanes(periods: CalendarPeriod[]): { lanes: Map<number, number>; count: number } {
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id - b.id)
  const ends: string[] = []
  const lanes = new Map<number, number>()
  for (const period of sorted) {
    let lane = ends.findIndex((end) => end < period.startDate)
    if (lane < 0) lane = ends.length
    ends[lane] = period.endDate
    lanes.set(period.id, lane)
  }
  return { lanes, count: ends.length }
}

export function periodRangeLabel(period: Pick<CalendarPeriod, 'startDate' | 'endDate' | 'precision'>): string {
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
