// Presentation only: native dragging and the store still own hit testing and persistence.
export function createBookDragMotion(root: () => HTMLElement | null) {
  let preview: HTMLElement | null = null
  const animations = new Set<Animation>()
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const elements = () => {
    const found = new Map<string, HTMLElement>()
    const page = root()
    page?.querySelectorAll<HTMLElement>('[data-book-id]').forEach((el) => {
      if (!el.closest('.collapsed')) found.set(`book:${el.dataset.bookId}`, el)
    })
    page?.querySelectorAll<HTMLElement>('[data-book-group]').forEach((group) => {
      const head = group.querySelector<HTMLElement>('.yy-book-group-head')
      if (head) found.set(`group:${group.dataset.bookGroup}`, head)
      const empty = group.querySelector<HTMLElement>('.yy-book-group-empty')
      if (empty && !empty.closest('.collapsed')) found.set(`empty:${group.dataset.bookGroup}`, empty)
    })
    for (const selector of ['.yy-book-card.add', '.yy-home-stats', '[data-book-recent]']) {
      const el = page?.querySelector<HTMLElement>(selector)
      if (el) found.set(selector, el)
    }
    return found
  }

  function clearPreview() {
    preview?.remove()
    preview = null
  }

  function cancelAnimations() {
    for (const animation of animations) animation.cancel()
    animations.clear()
    root()?.removeAttribute('data-book-drop-motion')
  }

  function play(el: HTMLElement, frames: Keyframe[], duration: number) {
    const animation = el.animate(frames, { duration, easing: 'cubic-bezier(.22, .8, .25, 1)' })
    animations.add(animation)
    const finish = () => {
      animations.delete(animation)
      if (!animations.size) root()?.removeAttribute('data-book-drop-motion')
    }
    void animation.finished.then(finish, finish)
  }

  function start(event: DragEvent) {
    const card = event.currentTarget as HTMLElement
    const grabbed = card.getBoundingClientRect()
    clearPreview()
    cancelAnimations()
    if (!event.dataTransfer) return
    const rect = card.getBoundingClientRect()
    const copy = card.cloneNode(true) as HTMLElement
    copy.className = 'yy-book-card yy-book-drag-preview'
    copy.removeAttribute('data-book-id')
    copy.removeAttribute('draggable')
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
    copy.style.width = `${rect.width}px`
    copy.style.height = `${rect.height}px`
    preview = document.createElement('div')
    preview.className = 'yy-book-drag-image'
    preview.setAttribute('aria-hidden', 'true')
    preview.inert = true
    preview.append(copy)
    document.body.append(preview)
    event.dataTransfer.setDragImage(preview,
      (event.clientX - grabbed.left) * rect.width / Math.max(1, grabbed.width) + 20,
      (event.clientY - grabbed.top) * rect.height / Math.max(1, grabbed.height) + 20)
  }

  function captureDrop(bookId: number | null) {
    // Capture the visible positions before cancelling any preceding landing animation.
    const before = new Map([...elements()].map(([key, el]) => [key, el.getBoundingClientRect()]))
    cancelAnimations()
    return () => {
      if (!root() || reduced() || bookId === null) return
      const after = elements()
      root()!.setAttribute('data-book-drop-motion', '')
      // Animate siblings individually: moving the whole target group would carry the dropped
      // card from its old group position and recreate the jump the user just removed.
      for (const [key, el] of after) {
        if (key === `book:${bookId}`) continue
        const old = before.get(key)
        if (!old) {
          if (key.startsWith('empty:')) play(el, [{ opacity: 0 }, { opacity: 1 }], 140)
          continue
        }
        const rect = el.getBoundingClientRect()
        const dx = old.left - rect.left, dy = old.top - rect.top
        if (Math.abs(dx) + Math.abs(dy) > 0.5) {
          play(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], 220)
        }
      }
      const card = after.get(`book:${bookId}`)
      if (card) {
        play(card, [
          { transform: 'scale(1.025)', boxShadow: '0 8px 24px rgb(0 163 95 / 16%)' },
          { transform: 'scale(.997)', offset: 0.72 },
          { transform: 'none', boxShadow: getComputedStyle(card).boxShadow },
        ], 260)
      } else {
        const group = root()!.querySelector<HTMLElement>(`[data-book-id="${bookId}"]`)?.closest('[data-book-group]')
        const count = group?.querySelector<HTMLElement>('.yy-group-count')
        if (count) play(count, [{ transform: 'scale(1.2)', color: 'var(--yy-primary)' }, { transform: 'none', color: 'var(--yy-text-3)' }], 220)
      }
      if (!animations.size) root()!.removeAttribute('data-book-drop-motion')
    }
  }

  return { start, clearPreview, captureDrop, dispose() { clearPreview(); cancelAnimations() } }
}
