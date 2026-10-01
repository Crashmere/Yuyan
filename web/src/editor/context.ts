import { inject, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { ImageEditMode } from './imageOperations'

// What the editor's toolbars, menus and panels share, provided by EditorPane.
export interface EditorContext {
  editor: ShallowRef<Editor | null>
  // Changes on every editor transaction; computed values read it so isActive() and can() update.
  tick: Ref<number>
  ui: EditorUi
}

export interface EditorUi {
  pickImage: () => void
  pickAttachment: () => void
  openLink: () => void
  openTemplates: () => void
  saveSnippet: () => void
  openMath: (pos: number, fresh?: boolean) => void
  openFind: () => void
  openTableGrid: (anchor: HTMLElement | DOMRect) => void
  openImageTools: (mode: ImageEditMode, positions?: number[]) => void
}

export const editorKey: InjectionKey<EditorContext> = Symbol('editor')

export function useEditorContext(): EditorContext {
  const ctx = inject(editorKey)
  if (!ctx) throw new Error('editor context missing')
  return ctx
}
