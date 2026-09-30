import { reactive, ref } from 'vue'
import { normalizeColor, textGradient } from '../schema/colors'

export type ColorChannel = 'text' | 'highlight' | 'cell'
interface ColorMemory { last: string | null; recent: string[] }
const storageKey = 'yuyan:colors'
const defaults: Record<ColorChannel, ColorMemory> = {
  text: { last: '#c03939', recent: [] }, highlight: { last: '#fff3a3', recent: [] }, cell: { last: '#e1f2e7', recent: [] },
}
function valid(value: unknown, channel: ColorChannel): string | null {
  if (typeof value !== 'string') return null
  if (channel === 'text' && value.startsWith('gradient:') && textGradient(value.slice(9))) return value
  return normalizeColor(value)
}
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    for (const channel of Object.keys(defaults) as ColorChannel[]) {
      const data = saved[channel]
      if (!data || typeof data !== 'object') continue
      if (data.last === null || valid(data.last, channel)) defaults[channel].last = valid(data.last, channel)
      if (Array.isArray(data.recent)) defaults[channel].recent = [...new Set<string>(data.recent.map(normalizeColor).filter(Boolean))].slice(0, 10)
    }
  } catch { /* Browser storage is optional. */ }
  return defaults
}
export const colorMemory = reactive(load())
// Hovering another colour arrow closes the previous panel, including across the two toolbars.
export const openColorPicker = ref<string | null>(null)
export function rememberColor(channel: ColorChannel, value: string | null, custom = false) {
  const memory = colorMemory[channel]
  memory.last = valid(value, channel)
  if (custom && normalizeColor(value)) memory.recent = [value!, ...memory.recent.filter(c => c !== value)].slice(0, 10)
  try { localStorage.setItem(storageKey, JSON.stringify(colorMemory)) } catch { /* Keep the in-page memory. */ }
}
