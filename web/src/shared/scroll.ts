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
  const original = { backgroundColor: style.backgroundColor, borderRadius: style.borderRadius }
  const highlight = { backgroundColor: background, borderRadius: radius }
  const frames = matchMedia('(prefers-reduced-motion: reduce)').matches ? [highlight, highlight] : [
    { ...original, easing: 'ease-in-out' },
    { ...highlight, offset: 500 / 2200 },
    { ...highlight, offset: 1700 / 2200, easing: 'ease-in-out' },
    original,
  ]
  const animation = target.animate(frames, { duration: 2200 })
  headingCue = animation
  animation.onfinish = () => { if (headingCue === animation) headingCue = undefined }
}
