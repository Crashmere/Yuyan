import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

type Target = { node: PMNode; pos: number } | null

// Keep a heading targeted while crossing its edge to the level-labelled grip.
// Observe mouse movement only: an overlay would steal text clicks/selections,
// and locking the drag plugin would disable dragging.
export function keepBlockHandleReachable(editor: Editor, target: () => Target, element: () => HTMLElement | null, menuOpen: () => boolean) {
  const surface = editor.view.dom, root = surface.ownerDocument
  let hideFrame = 0

  function region(event: MouseEvent) {
    const current = target(), handle = element()
    if (!current || !handle || editor.isDestroyed || !editor.isEditable || event.buttons || menuOpen() || handle.dataset.dragging === 'true' || handle.style.visibility === 'hidden') return null
    if (current.pos < 0 || current.pos > editor.state.doc.content.size || editor.state.doc.nodeAt(current.pos) !== current.node) return null
    if (current.node.type.name !== 'heading') return null
    const node = editor.view.nodeDOM(current.pos)
    if (!(node instanceof HTMLElement) || !node.getClientRects().length) return null
    const tools = handle.getBoundingClientRect(), block = node.getBoundingClientRect()
    const x = event.clientX, y = event.clientY
    const hit = (event.type === 'mouseleave' ? event.relatedTarget : event.target) as HTMLElement | null
    // Menus and dialogs above the document keep their own pointer handling.
    const onSurface = !!hit && (surface.contains(hit) || hit.contains(surface) || handle.contains(hit))
    return {
      bridge: onSurface && x >= tools.left - 2 && x <= block.left + 16 && y >= Math.min(tools.top, block.top) - 4 && y <= Math.max(tools.bottom, block.bottom) + 4,
      inBlock: onSurface && x >= block.left && x <= block.right && y >= block.top && y <= block.bottom,
    }
  }

  function move(event: MouseEvent) {
    cancelAnimationFrame(hideFrame)
    hideFrame = 0
    const area = region(event)
    const handle = element(), hit = event.target as globalThis.Node | null
    if (!area?.bridge && hit && !surface.contains(hit) && !handle?.contains(hit) && target() && !menuOpen() && !event.buttons && handle?.dataset.dragging !== 'true') {
      // The upstream picker resolves targets in RAF. Hide after an already queued pick,
      // otherwise a rapid exit can bring a stale heading handle back onto the page.
      hideFrame = requestAnimationFrame(() => {
        hideFrame = 0
        if (!editor.isDestroyed && !menuOpen()) editor.view.dispatch(editor.state.tr.setMeta('hideDragHandle', true))
      })
      return
    }
    if (!area) return
    if (area.bridge) {
      // Run before ProseMirror's mousemove listener can schedule a new target.
      // No preventDefault: native text selection and click placement keep working.
      event.stopPropagation()
    } else if (!area.inBlock) {
      // The picker keeps its previous target when no eligible node is found. Clear it
      // when moving onto ordinary content so a heading's grip cannot linger there.
      editor.view.dispatch(editor.state.tr.setMeta('hideDragHandle', true))
    }
  }
  function leave(event: MouseEvent) {
    if (event.target === surface && region(event)?.bridge) {
      event.stopImmediatePropagation()
    }
  }
  root.addEventListener('mousemove', move, true)
  surface.addEventListener('mouseleave', leave, true)
  return () => {
    cancelAnimationFrame(hideFrame)
    root.removeEventListener('mousemove', move, true)
    surface.removeEventListener('mouseleave', leave, true)
  }
}
