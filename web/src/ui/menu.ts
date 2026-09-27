import type { Component } from 'vue'

export interface MenuAction {
  label: string
  icon?: Component
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  hint?: string
  description?: string
  // Entries under this one open as a submenu; run is ignored then.
  children?: MenuEntry[]
  run?: () => void | Promise<void>
}

// A null entry draws a separator.
export type MenuEntry = MenuAction | null
