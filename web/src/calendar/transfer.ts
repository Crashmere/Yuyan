import { unitBounds } from './dates'
import { calendarDefaults, validCalendar, type CalendarData, type CalendarEntry, type CalendarPrecision } from '../schema/calendar'

const prefix = 'YYCAL1:'
const grains: Record<string, CalendarPrecision> = { y: 'year', m: 'month', d: 'day' }

// [title, grain, center, [[title, start, end?, color?, note?], ...], cellWidth?, width?, workdaysOnly?]
// Empty end means the starting unit; empty color means emerald. Trim empty tails.
export function encodeCalendar(data: CalendarData): string {
  if (!validCalendar(data)) throw new Error('日历内容不完整，请先完成当前编辑')
  const value: unknown[] = [data.title, data.grain[0], data.center, data.periods.map(p => {
    const length = p.precision === 'year' ? 4 : p.precision === 'month' ? 7 : 10
    const start = p.startDate.slice(0, length), end = p.endDate.slice(0, length)
    const row = [p.title, start, end === start ? '' : end, p.color === 'emerald' ? '' : p.color, p.note]
    while (row.length > 2 && row.at(-1) === '') row.pop()
    return row
  })]
  if (data.cellWidth != null || data.width != null || data.workdaysOnly) value.push(data.cellWidth ?? null)
  if (data.width != null || data.workdaysOnly) value.push(data.width ?? null)
  if (data.workdaysOnly) value.push(true)
  return prefix + JSON.stringify(value)
}

function decodePeriod(row: unknown, index: number): CalendarEntry {
  const fail = (reason: string): never => { throw new Error(`第 ${index + 1} 个事件：${reason}`) }
  if (!Array.isArray(row) || row.length < 2 || row.length > 5 || !row.every(v => typeof v === 'string')) return fail('格式不合法')
  const [title, start, end = '', color = '', note = ''] = row as string[]
  const pattern = /^(\d{4})(-\d{2})?(-\d{2})?$/
  if (!pattern.test(start) || (end && (!pattern.test(end) || end.length !== start.length))) return fail('起止时间须为相同精度的年、月或日期')
  const precision = start.length === 4 ? 'year' : start.length === 7 ? 'month' : 'day'
  const expand = (s: string) => precision === 'year' ? `${s}-01-01` : precision === 'month' ? `${s}-01` : s
  let startDate: string, endDate: string
  try {
    startDate = unitBounds(expand(start), precision).start
    endDate = unitBounds(expand(end || start), precision).end
  } catch { return fail('日期不存在，请检查起止时间') }
  const period = { id: index + 1, title, startDate, endDate, precision, color: color || 'emerald', note }
  if (!validCalendar({ ...calendarDefaults, periods: [period] })) return fail('名称、标注、颜色或时间范围不合法')
  return period as CalendarEntry
}

export function decodeCalendar(text: string): CalendarData {
  const source = text.trim()
  if (!source) throw new Error('剪贴板为空，请粘贴日历字符串')
  if (!source.startsWith(prefix)) throw new Error(/^YYCAL\d+:/.test(source) ? '暂不支持这个版本的日历字符串' : '不是日历字符串，请粘贴“复制日历”生成的完整内容')
  let value: unknown
  try { value = JSON.parse(source.slice(prefix.length)) }
  catch { throw new Error('日历字符串不完整或格式有误，请检查是否复制了全部内容') }
  if (!Array.isArray(value) || value.length < 4 || value.length > 7 || typeof value[1] !== 'string' || !Object.hasOwn(grains, value[1]) || !Array.isArray(value[3])) throw new Error('日历字符串结构不合法')
  if (value[3].length > 2000) throw new Error('单个日历最多保存 2,000 个事件')
  const data = { version: 1, title: value[0], grain: grains[value[1]], center: value[2], ...(value.length >= 5 ? { cellWidth: value[4] } : {}), ...(value.length >= 6 ? { width: value[5] } : {}), ...(value.length === 7 ? { workdaysOnly: value[6] } : {}), periods: value[3].map(decodePeriod) }
  if (!validCalendar(data)) throw new Error('日历名称、定位日期或配置不合法')
  return data
}
