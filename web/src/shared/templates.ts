import { shallowRef } from 'vue'
import type { JSONContent } from '@tiptap/core'
import { api, type ImageSizes } from './api'
import { prompt } from '../ui/dialog'
import { toast } from '../ui/toast'

export interface TemplateEntry { id: string; name: string; kind: 'document' | 'snippet'; revision: number; updatedAt: string; pinyin: string; snippet: string }
export interface ContentTemplate extends Omit<TemplateEntry, 'pinyin' | 'snippet'> { content: JSONContent; html: string; images: ImageSizes; schemaVersion: number }
export const templateRequest = shallowRef<{ mode: 'create' | 'insert'; resolve: (value: ContentTemplate | null) => void } | null>(null)
export function chooseTemplate(mode: 'create' | 'insert'): Promise<ContentTemplate | null> {
  templateRequest.value?.resolve(null)
  return new Promise(resolve => { templateRequest.value = { mode, resolve } })
}
export function closeTemplates(value: ContentTemplate | null = null) {
  const request = templateRequest.value
  templateRequest.value = null
  request?.resolve(value)
}
export async function saveTemplate(content: JSONContent, kind: 'document' | 'snippet', defaultName = '') {
  const name = await prompt({ title: kind === 'document' ? '保存为文档模板' : '保存为内容片段', placeholder: '起一个便于查找的名称', value: defaultName, confirmText: '保存' })
  if (!name) return
  await api('templates', { method: 'POST', json: { name, kind, content } })
  toast(kind === 'document' ? '文档模板已保存' : '内容片段已保存，可在 / 菜单中插入', 'success')
}
