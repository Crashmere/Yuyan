import './shortcuts.css'

export const macKeyboard = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
export const keyboardPlatform = macKeyboard ? 'macOS' : 'Windows / Linux'

const icons: Record<string, string> = {
  Option: 'M3 5h5l8 14h5M14 5h7',
  Shift: 'm12 3 8 8h-5v10H9V11H4Z',
  Control: 'm6 14 6-6 6 6',
  Backspace: 'M21 5H8l-6 7 6 7h13V5ZM11 9l6 6m0-6-6 6',
  ArrowUp: 'M12 20V4m-6 6 6-6 6 6',
  ArrowDown: 'M12 4v16m-6-6 6 6 6-6',
}

export interface ShortcutKey { label: string; text: string; path?: string }
function key(token: string): ShortcutKey {
  const label = ({ Mod: macKeyboard ? 'Command' : 'Ctrl', Alt: macKeyboard ? 'Option' : 'Alt', Ctrl: macKeyboard ? 'Control' : 'Ctrl', '⌫': 'Backspace', '↑': 'ArrowUp', '↓': 'ArrowDown' } as Record<string, string>)[token] ?? token
  const path = (macKeyboard || ['Backspace', 'ArrowUp', 'ArrowDown'].includes(label)) ? icons[label] : undefined
  return { label: label.length === 1 ? label.toUpperCase() : label, text: label === 'Command' ? '⌘' : label === 'Space' ? '空格' : label === '1…6' ? '1–6' : label.length === 1 ? label.toUpperCase() : label, path }
}

export function shortcutKeyGroups(combo: string) {
  return combo.split(' / ').map(alternative => {
    const sequence = alternative.includes(' → ')
    const keys = alternative.split(sequence ? ' → ' : /-(?!$)/).map(key)
    return { keys, sequence, label: keys.map(key => key.label).join(sequence ? ' 然后 ' : ' + ') }
  })
}

export const modifierLegend = macKeyboard ? ['Command', 'Option', 'Shift', 'Control'].map(key) : []

export function appendKeyIcon(parent: HTMLElement, key: ShortcutKey) {
  if (key.label === 'Command') {
    const symbol = document.createElement('span'); symbol.className = 'yy-system-key-symbol'; symbol.textContent = key.text; symbol.setAttribute('aria-hidden', 'true'); parent.append(symbol); return
  }
  if (!key.path) { parent.textContent = key.text; return }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '15', height: '15', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value)
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', key.path); svg.append(path); parent.append(svg)
}

export function appendShortcutKeys(parent: HTMLElement, combo: string) {
  parent.classList.add('yy-shortcut-keys')
  shortcutKeyGroups(combo).forEach((group, index) => {
    if (index) parent.append(Object.assign(document.createElement('span'), { className: 'yy-shortcut-or', textContent: '或' }))
    const chord = document.createElement('span'); chord.className = 'yy-shortcut-chord'; chord.setAttribute('aria-label', group.label)
    for (const [index, key] of group.keys.entries()) {
      if (group.sequence && index) chord.append(Object.assign(document.createElement('span'), { className: 'yy-shortcut-or', textContent: '→' }))
      const cap = document.createElement('kbd'); cap.className = 'yy-keycap'; cap.setAttribute('aria-label', key.label); cap.dataset.tip = key.label
      appendKeyIcon(cap, key); chord.append(cap)
    }
    parent.append(chord)
  })
}

export function appendShortcutLegend(parent: HTMLElement) {
  parent.className = 'yy-shortcuts-footer'
  const legend = document.createElement('div'); legend.className = 'yy-shortcut-legend'
  for (const key of modifierLegend) { const item = document.createElement('span'); appendKeyIcon(item, key); item.append(document.createTextNode(key.label)); legend.append(item) }
  const escape = document.createElement('span'); escape.className = 'yy-shortcuts-escape'; appendShortcutKeys(escape, 'Esc'); escape.append(document.createTextNode('关闭'))
  parent.append(legend, escape)
}
