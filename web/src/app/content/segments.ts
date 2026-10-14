import { ApiError, type ImageSizes } from '../../shared/api'
import type { SegmentSource } from './placeholders'
import { readingTop } from './readingPosition'

// Loads the segments of a long document (DESIGN 26.2) into the placeholders placeSegments put in
// root: those near the viewport while reading, and any other on request.
export interface SegmentHooks {
  // Prepares the blocks of segments from index on, in scope: hidden in the page at the width they
  // will have, so work that needs layout can run. They take their place once the returned promise
  // settles. html is what they were parsed from; firstCode counts the code blocks before them in
  // the document.
  prepare(scope: HTMLElement, index: number, html: string, firstCode: number, images: ImageSizes): Promise<unknown>
  // Runs once the blocks are in the page, before its position is kept.
  inserted(nodes: Element[]): void
  // The document changed or the server restarted since the page was read.
  stale(): void
}

export interface SegmentReader {
  start(): void
  ensure(index: number): Promise<void>
  ensureBlock(block: number): Promise<void>
  ensureId(id: string): Promise<void>
  loadAll(progress?: (loaded: number, total: number) => void): Promise<void>
  matches(query: string): Promise<number[]>
  complete(): boolean
  destroy(): void
}

// Placeholders within this distance of the viewport load. Requests join up to batch adjacent
// segments while reading and up to allBatch when loading everything.
const margin = '200% 0px'
const batch = 3
const allBatch = 4
const parallel = 2

export function readSegments(root: HTMLElement, source: SegmentSource, placeholders: HTMLElement[], hooks: SegmentHooks): SegmentReader {
  const count = source.items.length
  const starts = (key: 'blocks' | 'codes' | 'toc') => source.items.reduce((out, item) => [...out, out[out.length - 1] + item[key]], [0])
  const blockStart = starts('blocks'), codeStart = starts('codes'), tocStart = starts('toc')
  const loaded = new Set([0])
  const pending = new Map<number, Promise<boolean>>()
  const failed = new Set<number>()
  const near = new Set<number>()
  let active = 0, destroyed = false, stale = false
  const placeholder = (i: number) => placeholders[i - 1]

  const observer = new IntersectionObserver(entries => {
    for (const e of entries) {
      const i = Number((e.target as HTMLElement).dataset.segment)
      if (e.isIntersecting) near.add(i)
      else near.delete(i)
    }
    pump()
  }, { rootMargin: margin })

  // Starts loading the waiting segment nearest the middle of the viewport, with those after it.
  function pump() {
    while (!destroyed && !stale && active < parallel) {
      let from: number | undefined, distance = Infinity
      for (const i of near) {
        if (loaded.has(i) || pending.has(i) || failed.has(i)) continue
        const rect = placeholder(i).getBoundingClientRect()
        const d = Math.max(0, rect.top - innerHeight / 2, innerHeight / 2 - rect.bottom)
        if (d < distance) { distance = d; from = i }
      }
      if (from === undefined) return
      let to = from + 1
      while (to < count && to - from < batch && near.has(to) && waiting(to)) to++
      void load(from, to)
    }
  }

  const waiting = (i: number) => !loaded.has(i) && !pending.has(i) && !failed.has(i)

  function load(from: number, to: number): Promise<boolean> {
    active++
    const request = source.load(from, to).then(
      ({ html, images }) => insert(from, to, html, images),
      (e: unknown) => {
        if (destroyed) return false
        if (e instanceof ApiError && e.status === 409) {
          if (!stale) { stale = true; hooks.stale() }
        } else {
          for (let i = from; i < to; i++) fail(i)
        }
        return false
      },
    ).finally(() => {
      active--
      for (let i = from; i < to; i++) pending.delete(i)
      pump()
    })
    for (let i = from; i < to; i++) { pending.set(i, request); failed.delete(i) }
    return request
  }

  // Formulas, diagrams and saved code folds change the height of what they are in. Drawn before
  // the blocks join the page, they move what is being read at most once, by an amount
  // keepPosition can make up for, and a heading shown once its segment is in stays put.
  const stages = new Set<HTMLElement>()
  async function insert(from: number, to: number, html: string, images: ImageSizes): Promise<boolean> {
    if (destroyed) return false
    const stage = Object.assign(document.createElement('div'), { className: 'yy-content yy-segment-stage' })
    stage.innerHTML = html
    placeholder(from).append(stage)
    stages.add(stage)
    try {
      await hooks.prepare(stage, from, html, codeStart[from], images)
    } catch (e) {
      console.warn('segment', e)
    }
    stages.delete(stage)
    if (destroyed) return false
    const nodes = [...stage.children]
    keepPosition(placeholder(to - 1), () => {
      placeholder(from).replaceWith(...stage.childNodes)
      for (let i = from + 1; i < to; i++) placeholder(i).remove()
      hooks.inserted(nodes)
    })
    for (let i = from; i < to; i++) {
      loaded.add(i)
      near.delete(i)
      observer.unobserve(placeholder(i))
    }
    return true
  }

  // Content replacing a placeholder above what is being read would push it down; scroll by as
  // much. The browser's own scroll anchoring is off meanwhile, so it cannot add its correction.
  function keepPosition(last: HTMLElement, change: () => void) {
    if (last.getBoundingClientRect().bottom > readingTop()) { change(); return }
    const next = last.nextElementSibling
    const at = () => (next ? next.getBoundingClientRect().top : root.getBoundingClientRect().bottom)
    const before = at()
    suspendAnchoring()
    change()
    const delta = at() - before
    if (delta) window.scrollBy({ top: delta, behavior: 'instant' })
  }

  function fail(i: number) {
    failed.add(i)
    const el = placeholder(i)
    if (!el.isConnected || el.classList.contains('is-failed')) return
    el.classList.add('is-failed')
    el.removeAttribute('aria-hidden')
    const retry = Object.assign(document.createElement('button'), { type: 'button', className: 'yy-link-btn', textContent: '这部分没有载入，点击重试' })
    retry.addEventListener('click', () => { void ensure(i) }, { once: true })
    el.replaceChildren(retry)
  }

  function ensure(i: number): Promise<void> {
    if (i <= 0 || i >= count || loaded.has(i)) return Promise.resolve()
    const el = placeholder(i)
    if (el.classList.contains('is-failed')) {
      el.classList.remove('is-failed')
      el.setAttribute('aria-hidden', 'true')
      el.replaceChildren()
    }
    return (pending.get(i) ?? load(i, i + 1)).then(() => {})
  }

  // The segment holding item `at`, by the running totals of items before each segment.
  const segmentAt = (start: number[], at: number) => {
    let i = 0
    while (i + 1 < count && start[i + 1] <= at) i++
    return i
  }
  let outline: Map<string, number> | undefined
  function ensureId(id: string) {
    outline ??= new Map(source.toc.map((h, i) => [h.id, i]))
    const entry = outline.get(id)
    return ensure(entry !== undefined ? segmentAt(tocStart, entry) : source.items.findIndex(item => item.heads?.some(h => h[2] === id)))
  }

  async function loadAll(progress?: (loaded: number, total: number) => void) {
    while (!destroyed && !stale && loaded.size < count) {
      progress?.(loaded.size, count)
      const from = [...Array(count).keys()].find(i => !loaded.has(i) && !pending.has(i))
      if (from === undefined) { await Promise.all(pending.values()); continue }
      let to = from + 1
      while (to < count && to - from < allBatch && !loaded.has(to) && !pending.has(to)) to++
      if (!await load(from, to)) throw new Error(stale ? '文档已更新' : '网络或服务器出错')
    }
  }

  return {
    start() {
      placeholders.forEach((el, k) => { if (!loaded.has(k + 1)) observer.observe(el) })
    },
    ensure,
    ensureBlock: block => ensure(segmentAt(blockStart, block)),
    ensureId,
    loadAll,
    matches(query) {
      return source.matches(query).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 409 && !stale && !destroyed) { stale = true; hooks.stale() }
        return []
      })
    },
    complete: () => loaded.size === count,
    destroy() {
      destroyed = true
      observer.disconnect()
      stages.forEach(stage => stage.remove())
    },
  }
}

let suspended = 0
function suspendAnchoring() {
  const style = document.documentElement.style
  if (!suspended++) style.overflowAnchor = 'none'
  requestAnimationFrame(() => setTimeout(() => { if (!--suspended) style.overflowAnchor = '' }))
}
