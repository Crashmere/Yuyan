import { shallowRef } from 'vue'
import { deferred } from '../shared/deferred'
import type { MenuEntry } from './menu'

export interface ContextMenuRequest {
  x: number
  y: number
  // Read while the menu is open, so its entries stay current.
  items: () => MenuEntry[]
  onOpenChange: (open: boolean) => void
}

export interface OpenContextMenu extends ContextMenuRequest {
  owner: object
  id: number
}

// The site's one right-click menu (ContextMenuHost), opened by ContextActions. Only one shows at a
// time; a new request replaces the open one.
export const contextMenuHost = deferred(() => import('./ContextMenuHost.vue'))
export const contextMenu = shallowRef<OpenContextMenu | null>(null)
let requests = 0

export function openContextMenu(owner: object, request: ContextMenuRequest) {
  const previous = contextMenu.value
  contextMenu.value = { ...request, owner, id: ++requests }
  if (previous && previous.owner !== owner) previous.onOpenChange(false)
  contextMenuHost.load().catch(() => closeContextMenu(owner))
}

// Closes the menu, or only the owner's menu when given.
export function closeContextMenu(owner?: object) {
  const current = contextMenu.value
  if (!current || (owner && current.owner !== owner)) return
  contextMenu.value = null
  current.onOpenChange(false)
}
