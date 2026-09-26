import { autoUpdate, computePosition, flip, offset, shift, type Placement, type VirtualElement } from '@floating-ui/dom'

// An element, or a live rectangle (such as a position in the editor) inside a scrolling context.
export type Anchor = HTMLElement | { rect: () => DOMRect; context: Element }

// place keeps a fixed-position panel next to its anchor, following scrolling and resizing, and
// returns the function that stops following.
export function place(panel: HTMLElement, anchor: Anchor, placement: Placement = 'bottom-start'): () => void {
  const reference: HTMLElement | VirtualElement =
    anchor instanceof HTMLElement ? anchor : { getBoundingClientRect: anchor.rect, contextElement: anchor.context }
  const update = () =>
    computePosition(reference, panel, { placement, strategy: 'fixed', middleware: [offset(8), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
      Object.assign(panel.style, { left: `${x}px`, top: `${y}px` })
    })
  return autoUpdate(reference, panel, update)
}

// Closes a panel when the pointer goes down outside it (and outside anything in keep).
export function onOutside(panel: () => HTMLElement | null, close: () => void, keep: () => (Element | null)[] = () => []): () => void {
  const handler = (e: PointerEvent) => {
    const target = e.target as Node
    const inside = [panel(), ...keep()].some((el) => el?.contains(target))
    if (!inside) close()
  }
  document.addEventListener('pointerdown', handler, true)
  return () => document.removeEventListener('pointerdown', handler, true)
}
