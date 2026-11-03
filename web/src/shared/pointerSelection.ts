let previous: PointerEvent | undefined
let moved: PointerEvent | undefined

export function installPointerSelection() {
  // Track outside result lists too; the first native move can report zero movementX/Y.
  window.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return
    moved = !previous || event.clientX !== previous.clientX || event.clientY !== previous.clientY ? event : undefined
    previous = event
  }, true)
}

// Result updates and keyboard scrolling can put a new row under a stationary pointer.
export function pointerMoved(event: PointerEvent): boolean {
  return moved === event
}
