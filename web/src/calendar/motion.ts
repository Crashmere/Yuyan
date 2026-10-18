// Animate paint only; timeline coordinates and floating-window geometry stay immediate.
const active = new WeakMap<HTMLElement, Animation>()

export function animateCalendar(element: HTMLElement | undefined | null, frames: Keyframe[], duration = 160) {
  if (!element) return
  active.get(element)?.cancel()
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22, .8, .25, 1)' })
  active.set(element, animation)
  animation.onfinish = () => active.delete(element)
}
