import { reactive } from 'vue'

export type ToastType = 'info' | 'success' | 'error' | 'loading'

export interface Toast {
  id: number
  key?: string
  message: string
  type: ToastType
}

export const toasts = reactive<Toast[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let seq = 0

function dismiss(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

// toast shows a short message. A toast with a key replaces the previous one with the same key,
// which suits progress messages such as an upload that later succeeds or fails. ms = 0 keeps it
// until it is replaced or dismissed.
export function toast(message: string, type: ToastType = 'info', options: { key?: string; ms?: number } = {}): () => void {
  const ms = options.ms ?? (type === 'error' ? 6000 : type === 'loading' ? 0 : 2500)
  const existing = options.key ? toasts.find((t) => t.key === options.key) : undefined
  const t = existing ?? reactive({ id: ++seq, key: options.key, message, type })
  t.message = message
  t.type = type
  if (!existing) toasts.push(t)
  clearTimeout(timers.get(t.id))
  if (ms > 0) timers.set(t.id, setTimeout(() => dismiss(t.id), ms))
  return () => dismiss(t.id)
}
