import type { Editor } from '@tiptap/core'

interface PendingBlock { dirty(): boolean; flush(): Promise<boolean> }
const blocks = new WeakMap<Editor, Set<PendingBlock>>()
export function registerPendingBlock(editor: Editor, block: PendingBlock): () => void {
  const entries = blocks.get(editor) ?? new Set<PendingBlock>()
  entries.add(block)
  blocks.set(editor, entries)
  return () => entries.delete(block)
}
export function hasPendingBlocks(editor: Editor): boolean {
  return [...(blocks.get(editor) ?? [])].some(block => block.dirty())
}
export async function flushPendingBlocks(editor: Editor): Promise<boolean> {
  for (const block of blocks.get(editor) ?? []) if (!await block.flush()) return false
  return true
}
