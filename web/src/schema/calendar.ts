import { Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { canonicalRange, parseCalendarDate } from '../calendar/dates'

export type CalendarPrecision = 'year' | 'month' | 'day'
export interface CalendarEntry {
  id: number
  title: string
  note: string
  startDate: string
  endDate: string
  precision: CalendarPrecision
  color: string
}
export interface CalendarData {
  version: number
  title: string
  grain: CalendarPrecision
  center: string
  collapsed?: boolean
  workdaysOnly?: boolean
  cellWidth?: number | null
  width?: number | null
  periods: CalendarEntry[]
}
export const calendarDefaults: CalendarData = { version: 1, title: '日历', grain: 'month', center: '', collapsed: false, workdaysOnly: false, cellWidth: null, width: null, periods: [] }
export const calendarCellWidths: Record<CalendarPrecision, { default: number; min: number; max: number }> = {
  year: { default: 88, min: 56, max: 240 },
  month: { default: 80, min: 48, max: 220 },
  day: { default: 48, min: 36, max: 180 },
}
const grains = ['year', 'month', 'day']
const colors = ['emerald', 'blue', 'violet', 'amber', 'rose', 'cyan', 'slate', 'lime']
function date(value: unknown): value is string {
  if (typeof value !== 'string' || value < '1000-01-01' || value > '9999-12-31') return false
  try { parseCalendarDate(value); return true } catch { return false }
}
export function validCalendar(value: unknown): value is CalendarData {
  const a = value as CalendarData | undefined
  if (!a || a.version !== 1 || typeof a.title !== 'string' || [...a.title].length > 120 || !grains.includes(a.grain) || (a.center !== '' && !date(a.center)) || !Array.isArray(a.periods) || a.periods.length > 2000) return false
  if (a.collapsed !== undefined && typeof a.collapsed !== 'boolean') return false
  if (a.workdaysOnly !== undefined && typeof a.workdaysOnly !== 'boolean') return false
  if (a.cellWidth != null && (typeof a.cellWidth !== 'number' || !Number.isFinite(a.cellWidth) || a.cellWidth < calendarCellWidths[a.grain].min || a.cellWidth > calendarCellWidths[a.grain].max)) return false
  if (a.width != null && (!Number.isInteger(a.width) || a.width < 280 || a.width > 10000)) return false
  const ids = new Set<number>()
  return a.periods.every(p => {
    if (!p || !Number.isSafeInteger(p.id) || p.id < 1 || ids.has(p.id) || typeof p.title !== 'string' || !p.title.trim() || [...p.title].length > 120 || typeof p.note !== 'string' || [...p.note].length > 2000 || !date(p.startDate) || !date(p.endDate) || p.startDate > p.endDate || !grains.includes(p.precision) || !colors.includes(p.color)) return false
    ids.add(p.id)
    const range = canonicalRange(p.startDate, p.endDate, p.precision)
    return range.startDate === p.startDate && range.endDate === p.endDate
  })
}
export function parseCalendarHTML(element: HTMLElement): CalendarData | false {
  try {
    const data = JSON.parse(element.getAttribute('data-calendar-content') ?? '')
    return validCalendar(data) ? data : false
  } catch { return false }
}
export function calendarText(a: CalendarData): string {
  return [a.title, ...a.periods.map(p => `${p.title} ${p.startDate} – ${p.endDate}\n${p.note}`)].join('\n')
}
export const Calendar = Node.create({
  name: 'calendar', group: 'block', atom: true, draggable: true,
  addAttributes() {
    return Object.fromEntries(Object.entries(calendarDefaults).map(([key, value]) => [key, { default: value, rendered: false }]))
  },
  parseHTML() { return [{ tag: 'section[data-calendar]', getAttrs: element => parseCalendarHTML(element) }] },
  renderText({ node }) { return calendarText(node.attrs as CalendarData) },
  renderHTML({ node }): DOMOutputSpec {
    const a = node.attrs as CalendarData
    return ['section', { 'data-calendar': a.version, 'data-calendar-content': JSON.stringify(a), class: 'yy-calendar-block' },
      ['strong', {}, a.title || '日历'],
      ['table', {}, ['thead', {}, ['tr', {}, ...['事件', '起始', '结束', '标注'].map(label => ['th', {}, label] as DOMOutputSpec)]],
        ['tbody', {}, ...a.periods.map(p => ['tr', {}, ...[p.title, p.startDate, p.endDate, p.note].map(text => ['td', {}, text] as DOMOutputSpec)] as DOMOutputSpec)]]]
  },
})
