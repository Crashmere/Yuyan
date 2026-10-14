// Navigation always lands immediately. A heading selected from the outline or a link gets a
// soft green row for two seconds, without writing styles or attributes into the editable document.
let headingCue: Animation | undefined

export function clearJumpCue() {
  headingCue?.cancel()
  headingCue = undefined
}

export function scrollToPosition(scroller: HTMLElement, position: { top?: number; left?: number }) {
  clearJumpCue()
  const top = Math.max(0, Math.min(position.top ?? scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight))
  const left = Math.max(0, Math.min(position.left ?? scroller.scrollLeft, scroller.scrollWidth - scroller.clientWidth))
  scroller.scrollTo({ left, top, behavior: 'instant' })
}

// Content navigation moves the page only; nested code and table scrollers keep their positions.
// Honour the heading margins in reading and editing modes, including the editor's toolbar.
export function scrollToElement(target: Element, block: 'start' | 'center' = 'start', indicateHeading = false) {
  const scroller = document.scrollingElement as HTMLElement | null
  if (!scroller || !target.isConnected) return
  const rect = target.getBoundingClientRect(), style = getComputedStyle(target)
  const margin = parseFloat(style.scrollMarginTop) || 0
  const offset = block === 'center' ? Math.max(margin, (innerHeight - rect.height) / 2) : margin
  scrollToPosition(scroller, { top: scroller.scrollTop + rect.top - offset })
  if (!indicateHeading || !target.matches('h1,h2,h3,h4,h5,h6')) return
  const background = style.getPropertyValue('--yy-primary-soft').trim()
  const radius = style.getPropertyValue('--yy-radius').trim()
  const animation = target.animate([
    { backgroundColor: background, borderRadius: radius },
    { backgroundColor: background, borderRadius: radius, offset: 2000 / 2200 },
    { backgroundColor: style.backgroundColor, borderRadius: style.borderRadius },
  ], { duration: 2200, easing: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'steps(1, end)' : 'linear' })
  headingCue = animation
  animation.onfinish = () => { if (headingCue === animation) headingCue = undefined }
}
