import { diffChars } from 'diff'

let worker: Worker | undefined, sequence = 0, idle: ReturnType<typeof setTimeout> | undefined
const pending = new Map<number, { resolve: (source: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function stop(message: string) {
  worker?.terminate(); worker = undefined; clearTimeout(idle)
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(message)) }
  pending.clear()
}
export function formatCode(source: string, language: string): Promise<string> {
  clearTimeout(idle)
  if (!worker) {
    worker = new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ id: number; source: string; error?: string }>) => {
      const task = pending.get(data.id)
      if (!task) return
      clearTimeout(task.timer); pending.delete(data.id)
      if (data.error) task.reject(new Error(data.error)); else task.resolve(data.source)
      if (!pending.size) idle = setTimeout(() => stop(''), 60_000)
    }
    worker.onerror = event => { event.preventDefault(); stop('格式化工具加载失败，请重试') }
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject, timer: setTimeout(() => stop('格式化耗时过长，请稍后重试'), 60_000) })
    worker!.postMessage({ id, source, language })
  })
}

// Map carets through the actual text edits, including any unchanged names between spaces.
export function formatChanges(before: string, after: string) {
  const parts = diffChars(before, after, { timeout: 100 })
  if (!parts) return [{ from: 0, to: before.length, insert: after }]
  const changes: { from: number; to: number; insert: string }[] = []
  let pos = 0
  for (const part of parts) {
    if (part.added) changes.push({ from: pos, to: pos, insert: part.value })
    else if (part.removed) { changes.push({ from: pos, to: pos + part.value.length, insert: '' }); pos += part.value.length }
    else pos += part.value.length
  }
  return changes
}
