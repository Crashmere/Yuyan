import type { InjectionKey, Ref } from 'vue'
import type { TreeNode } from '../../shared/api'
import type { MenuEntry } from '../../ui/menu'

export type DropPosition = 'before' | 'after' | 'inside'

// What every row of a knowledge base tree shares, provided by BookTree.
export interface TreeContext {
  bookId: number
  currentId: () => number | null
  isOpen: (id: number) => boolean
  toggle: (id: number, open?: boolean) => void
  selecting: () => boolean
  selectionState: (node: TreeNode) => boolean | 'mixed'
  select: (node: TreeNode, range?: boolean) => void
  busy: () => boolean
  renaming: Ref<number | null>
  finishRename: (node: TreeNode, title: string | null) => void
  menu: (node: TreeNode) => MenuEntry[]
  drag: { id: number | null; overId: number | null; position: DropPosition | null }
  onDragStart: (node: TreeNode, e: DragEvent) => void
  onDragOver: (node: TreeNode, e: DragEvent) => void
  onDrop: (node: TreeNode, e: DragEvent) => void
  onDragEnd: () => void
}

export const treeKey: InjectionKey<TreeContext> = Symbol('tree')
