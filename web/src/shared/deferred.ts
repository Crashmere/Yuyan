import { shallowRef, type ShallowRef } from 'vue'

// Code the reading page may need at any moment but not to show itself: menus, dialogs, the image
// viewer, the search panel and floating positioning (DESIGN 26.5). Each part downloads the first
// time it is used, and all of them once the first page has shown and the browser is idle, so a
// first use later rarely waits for the network.

export interface Deferred<T> {
  // The module once it has loaded, for templates to render from.
  readonly module: ShallowRef<T | undefined>
  // Loads the module, or returns the load in progress. After a failure the next call imports again,
  // but Chrome keeps a failed module import until the page reloads.
  load(): Promise<T>
}

const parts: Deferred<unknown>[] = []

export function deferred<T>(importer: () => Promise<T>): Deferred<T> {
  const module = shallowRef<T>()
  let pending: Promise<T> | undefined
  const part: Deferred<T> = {
    module,
    load: () => (pending ??= importer().then(
      (loaded) => (module.value = loaded),
      (error: unknown) => {
        pending = undefined
        throw error
      },
    )),
  }
  parts.push(part)
  return part
}

let prefetching = false

// Loads every part once the browser is idle, unless it asks to save data. A failure shows the
// module load notice (shared/moduleLoad.ts), which asks for a refresh.
export function prefetchDeferred() {
  if (prefetching) return
  prefetching = true
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
  const run = () => {
    for (const part of parts) part.load().catch(() => {})
  }
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 })
  else setTimeout(run, 2000)
}
