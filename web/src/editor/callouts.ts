import type { Component } from 'vue'
import { Bug, Check, CircleCheck, CircleQuestionMark, ClipboardList, Code, Flame, Info, List, MessageSquare, Pencil, Quote, TriangleAlert, X, Zap } from 'lucide-vue-next'
import { calloutTypes } from '../schema/callout'

export interface CalloutMeta {
  label: string
  icon: Component
  // RGB, as in content.css.
  color: string
}

const meta: Record<string, CalloutMeta> = {
  note: { label: '提示', icon: Pencil, color: '68, 138, 255' },
  abstract: { label: '摘要', icon: ClipboardList, color: '0, 176, 255' },
  info: { label: '信息', icon: Info, color: '0, 184, 212' },
  todo: { label: '待办', icon: CircleCheck, color: '68, 138, 255' },
  tip: { label: '技巧', icon: Flame, color: '0, 191, 165' },
  success: { label: '成功', icon: Check, color: '0, 200, 83' },
  question: { label: '问题', icon: CircleQuestionMark, color: '100, 190, 23' },
  warning: { label: '警告', icon: TriangleAlert, color: '255, 145, 0' },
  failure: { label: '失败', icon: X, color: '255, 82, 82' },
  danger: { label: '危险', icon: Zap, color: '255, 23, 68' },
  bug: { label: '缺陷', icon: Bug, color: '245, 0, 87' },
  example: { label: '示例', icon: List, color: '124, 77, 255' },
  quote: { label: '引用', icon: Quote, color: '158, 158, 158' },
  code: { label: '代码', icon: Code, color: '96, 125, 139' },
}

export function calloutMeta(type: string): CalloutMeta {
  return meta[type] ?? { label: type, icon: MessageSquare, color: '68, 138, 255' }
}

// The title reading pages show for an empty title (see content.css), which follows Obsidian.
export function defaultTitle(type: string): string {
  return calloutTypes.includes(type) ? type[0].toUpperCase() + type.slice(1) : 'Callout'
}
