import type { Component } from 'vue'

export interface MenuAction {
  label: string
  icon?: Component
  danger?: boolean
  disabled?: boolean
  hint?: string
  run: () => void | Promise<void>
}

// A null entry draws a separator.
export type MenuEntry = MenuAction | null
