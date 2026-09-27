import { codeShortcutRows } from './keymap'
import { keyLabel } from '../editor/keys'

export function showCodeShortcuts() {
  if (document.querySelector('.yy-code-shortcuts')) return
  const previous = document.activeElement as HTMLElement | null
  const dialog = document.createElement('dialog'); dialog.className = 'yy-code-shortcuts'; dialog.setAttribute('aria-labelledby', 'yy-code-shortcuts-title')
  const header = document.createElement('div'); header.className = 'yy-code-shortcuts-title'
  const title = document.createElement('h2'); title.id = 'yy-code-shortcuts-title'; title.textContent = '代码块快捷键'
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭代码块快捷键'); close.dataset.tip = '关闭'; close.onclick = () => dialog.close()
  const intro = document.createElement('p'); intro.textContent = 'JetBrains 默认方案 · 在编辑模式的代码区内生效'
  const list = document.createElement('dl')
  for (const [name, combo] of codeShortcutRows()) {
    const label = document.createElement('dt'); label.textContent = name
    const value = document.createElement('dd'), key = document.createElement('kbd'); key.textContent = keyLabel(combo); value.append(key); list.append(label, value)
  }
  header.append(title, close); dialog.append(header, intro, list); document.body.append(dialog)
  const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
  dialog.addEventListener('close', () => { document.body.style.overflow = overflow; dialog.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }, { once: true })
  dialog.showModal()
  return () => { if (dialog.open) dialog.close() }
}
