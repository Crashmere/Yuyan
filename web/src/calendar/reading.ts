import { createApp } from 'vue'
import CalendarPanel from './CalendarPanel.vue'
import { parseCalendarHTML } from '../schema/calendar'

export function enhanceCalendars(scope: HTMLElement): () => void {
  const cleanups: (() => void)[] = []
  for (const element of scope.querySelectorAll<HTMLElement>('section[data-calendar]')) {
    if (element.dataset.enhanced || element.closest('.yy-recent-ghost')) continue
    const model = parseCalendarHTML(element)
    if (!model) continue
    element.dataset.enhanced = '1'
    // Retain the export source offscreen for text search and restore it during cleanup.
    const source = document.createElement('div')
    source.className = 'yy-calendar-source'
    source.setAttribute('aria-hidden', 'true')
    while (element.firstChild) source.append(element.firstChild)
    const host = document.createElement('div')
    element.append(host, source)
    const app = createApp(CalendarPanel, { model, readonly: true })
    const panel = app.mount(host) as unknown as { revealMatch(query: string): Promise<HTMLElement | null> }
    const matched = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      event.stopPropagation()
      event.detail.ready = panel.revealMatch(event.detail.query)
    }
    element.addEventListener('yy-reveal-calendar', matched)
    cleanups.push(() => { element.removeEventListener('yy-reveal-calendar', matched); app.unmount(); element.replaceChildren(...source.childNodes); delete element.dataset.enhanced })
  }
  return () => cleanups.forEach(cleanup => cleanup())
}
