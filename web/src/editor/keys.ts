const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
const names: Record<string, string> = mac ? { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' } : { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Ctrl: 'Ctrl' }

// keyLabel turns Tiptap's notation, such as "Mod-Alt-1", into "⌘⌥1" on macOS and "Ctrl+Alt+1" elsewhere.
export function keyLabel(combo: string): string {
  const parts = combo.split(/-(?!$)/).map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p))
  return mac ? parts.join('') : parts.join('+')
}

export function withKey(label: string, combo?: string): string {
  return combo ? `${label}  ${keyLabel(combo)}` : label
}
