// Keep a wheel gesture in the popup, including its non-scrolling padding and either end.
// Hover only changes the active item; it must not scroll the page to reveal that item.
export function containMenuWheel(event: WheelEvent) {
  if (event.ctrlKey) return
  const menu = event.currentTarget as HTMLElement
  let scroller = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-menu-scroll]') : null
  scroller ??= menu.querySelector<HTMLElement>('[data-menu-scroll]') ?? menu
  event.preventDefault()
  event.stopPropagation()
  const unit = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? scroller.clientHeight : 1
  scroller.scrollTop += event.deltaY * unit
  scroller.scrollLeft += event.deltaX * unit
}
