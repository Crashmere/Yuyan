import { onBeforeUnmount, onMounted, ref } from 'vue'

// Tracks which heading's section is being read, for the outlines of reading pages and the editor.
// It is the last heading above a line just below where jumps put headings (their scroll margin);
// over the last screen of the page the line moves down to the bottom of the window, so the final
// sections, whose headings cannot reach it, get their turn. Headings without a box (in folded
// sections) are skipped. headings() lists the heading elements in document order; line() is the
// line's distance from the top of the window.
export function useOutlineTracking(headings: () => (Element | null)[], line: () => number) {
  const active = ref(-1)
  let frame = 0

  function update() {
    frame = 0
    if (jumping) return
    const root = document.documentElement
    const base = line()
    const room = innerHeight - base
    const scrollable = root.scrollHeight - innerHeight
    const span = Math.min(scrollable, room)
    const left = scrollable - scrollY
    const at = span > 0 && left < span ? base + room * (1 - left / span) : base
    const els = headings()
    const current = lastAbove(els, at)
    active.value = current < 0 && els.length ? 0 : current
  }

  function refresh() {
    if (!frame) frame = requestAnimationFrame(update)
  }

  // After a jump from the outline the entry clicked stays highlighted: a heading near the end
  // may never reach the tracking line. Once the page has been
  // still for a moment, the next scroll follows the page again.
  let jumping = false
  let still = false
  let stillTimer: ReturnType<typeof setTimeout> | undefined
  function waitStill() {
    clearTimeout(stillTimer)
    stillTimer = setTimeout(() => (still = true), 150)
  }
  function onScroll() {
    if (jumping) {
      if (!still) return waitStill()
      jumping = false
    }
    refresh()
  }
  function jumped(index: number) {
    active.value = index
    jumping = true
    still = false
    waitStill()
  }

  onMounted(() => {
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', refresh)
  })
  onBeforeUnmount(() => {
    removeEventListener('scroll', onScroll)
    removeEventListener('resize', refresh)
    cancelAnimationFrame(frame)
    clearTimeout(stillTimer)
  })
  return { active, refresh, jumped }
}

// The last heading with a box whose top is at or above `at`, or -1. Headings are in document
// order, so their tops only grow and a long outline needs only a few measurements.
function lastAbove(els: (Element | null)[], at: number): number {
  let lo = 0
  let hi = els.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    let i = mid
    while (i <= hi && !els[i]?.getClientRects().length) i++
    if (i <= hi && els[i]!.getBoundingClientRect().top <= at) {
      found = i
      lo = i + 1
    } else hi = mid - 1
  }
  return found
}

// The height of the top bar, from tokens.css.
export function topbarHeight(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--yy-topbar')) || 52
}
