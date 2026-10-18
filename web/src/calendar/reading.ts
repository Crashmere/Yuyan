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
    // Keep searchable text in the DOM; the interactive controls display only the current window.
    const source = document.createElement('div')
    source.className = 'yy-calendar-source'
    while (element.firstChild) source.append(element.firstChild)
    const host = document.createElement('div')
    const details = document.createElement('details')
    details.className = 'yy-calendar-records'
    const summary = document.createElement('summary')
    summary.textContent = '全部状态与标注'
    details.append(summary, source)
    element.append(host, details)
    const app = createApp(CalendarPanel, { model, readonly: true })
    app.mount(host)
    cleanups.push(() => { app.unmount(); element.replaceChildren(...source.childNodes); delete element.dataset.enhanced })
  }
  return () => cleanups.forEach(cleanup => cleanup())
}
