import { base } from './api'

export interface DocEvent {
  docId: number
  revision: number
  updatedAt?: string
  kind: 'sync' | 'updated' | 'deleted'
  source?: string
}

// Subscribes to server-pushed revision/deletion events for one document over SSE.
// Hidden tabs close their stream and immediately resync on returning to the foreground.
export function watchDocEvents(docId: number, onEvent: (event: DocEvent) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {}

  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let delay = 2000
  let closed = false

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const disconnect = () => {
    clearTimer()
    if (source) {
      source.close()
      source = null
    }
  }

  const scheduleReconnect = () => {
    if (closed || document.visibilityState === 'hidden' || navigator.onLine === false) return
    clearTimer()
    const wait = delay + Math.floor(Math.random() * 500)
    delay = Math.min(delay * 2, 30000)
    timer = setTimeout(connect, wait)
  }

  const connect = () => {
    if (closed || source || document.visibilityState === 'hidden' || navigator.onLine === false) return
    clearTimer()
    const es = new EventSource(`${base}api/docs/${docId}/events`)
    source = es
    es.onopen = () => {
      if (source === es) delay = 2000
    }
    es.addEventListener('doc', (raw) => {
      if (closed || source !== es) return
      delay = 2000
      let event: DocEvent
      try {
        event = JSON.parse((raw as MessageEvent<string>).data)
      } catch {
        return
      }
      if (event.docId !== docId) return
      if (event.kind === 'deleted') {
        closed = true
        disconnect()
      }
      onEvent(event)
    })
    es.onerror = () => {
      if (source !== es) return
      es.close()
      source = null
      scheduleReconnect()
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      disconnect()
    } else {
      delay = 2000
      connect()
    }
  }

  const onOnline = () => {
    delay = 2000
    connect()
  }

  const onOffline = () => {
    disconnect()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  connect()

  return () => {
    closed = true
    disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}
