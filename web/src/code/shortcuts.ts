import { codeShortcutRows } from './keymap'
import { appendShortcutKeys, appendShortcutLegend, keyboardPlatform } from '../ui/shortcutKeys'

export function showCodeShortcuts() {
  if (document.querySelector('.yy-code-shortcuts')) return
  const previous = document.activeElement as HTMLElement | null
  const dialog = document.createElement('dialog'); dialog.className = 'yy-code-shortcuts yy-shortcuts-shell'; dialog.setAttribute('aria-labelledby', 'yy-code-shortcuts-title')
  const header = document.createElement('div'); header.className = 'yy-shortcuts-header'
  const title = document.createElement('h2'); title.id = 'yy-code-shortcuts-title'; title.textContent = '代码块快捷键'
  const platform = document.createElement('span'); platform.className = 'yy-shortcuts-platform'; platform.textContent = keyboardPlatform
  const close = document.createElement('button'); close.type = 'button'; close.className = 'yy-shortcuts-close'; close.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>'; close.setAttribute('aria-label', '关闭代码块快捷键'); close.dataset.tip = '关闭'; close.onclick = () => dialog.close()
  const body = document.createElement('div'); body.className = 'yy-shortcuts-body'
  const intro = document.createElement('p'); intro.className = 'yy-shortcuts-description'; intro.textContent = 'JetBrains 默认方案 · 在编辑模式的代码区内生效'
  const list = document.createElement('dl'); list.className = 'yy-shortcut-list'
  for (const [name, combo] of codeShortcutRows()) {
    const row = document.createElement('div'); row.className = 'yy-shortcut-row'
    const label = document.createElement('dt'); label.textContent = name
    const value = document.createElement('dd'); appendShortcutKeys(value, combo); row.append(label, value); list.append(row)
  }
  const footer = document.createElement('footer'); appendShortcutLegend(footer)
  header.append(title, platform, close); body.append(intro, list); dialog.append(header, body, footer); document.body.append(dialog)
  const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
  dialog.addEventListener('close', () => { document.body.style.overflow = overflow; dialog.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }, { once: true })
  dialog.showModal()
  return () => { if (dialog.open) dialog.close() }
}
