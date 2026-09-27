import type { CodeEditor } from './editor'
import { copyText } from '../shared/clipboard'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { containMenuWheel } from '../ui/menuWheel'

export type CodeAction = 'expand' | 'find' | 'format' | 'fold' | 'unfold' | 'shortcuts'

export function codeActions(parent: HTMLElement, run: (action: CodeAction) => void, editable = false, canFormat = () => false) {
  const button = (label: string, path: string) => {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'yy-code-action'; b.dataset.tip = label; b.setAttribute('aria-label', label)
    b.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`
    b.addEventListener('mousedown', e => e.preventDefault())
    return b
  }
  const expand = button('放大代码块', 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5')
  const more = button('代码块更多操作', 'M5 11v2m7-2v2m7-2v2')
  expand.onclick = () => run('expand')
  let menu: HTMLElement | undefined
  let stopPosition: (() => void) | undefined
  let closeShortcuts: (() => void) | undefined
  const close = () => { stopPosition?.(); stopPosition = undefined; menu?.remove(); menu = undefined; more.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  const outside = (e: Event) => { if (!menu?.contains(e.target as Node) && !more.contains(e.target as Node)) close() }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); more.focus() } }
  more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false')
  more.onclick = () => {
    if (menu) { close(); return }
    menu = document.createElement('div'); menu.className = 'yy-code-menu'; menu.setAttribute('role', 'menu')
    const items: [CodeAction, string][] = [['find', '在代码块中查找'], ['fold', '折叠所有代码区域'], ['unfold', '展开所有代码区域'], ['shortcuts', '代码块快捷键']]
    if (editable) items.splice(1, 0, ['format', '格式化代码'])
    for (const [action, text] of items) {
      const item = document.createElement('button'); item.type = 'button'; item.textContent = text; item.setAttribute('role', 'menuitem')
      if (action === 'format' && !canFormat()) { item.disabled = true; item.dataset.tip = '当前语言暂不支持格式化'; item.textContent = '格式化代码（此语言暂不支持）' }
      item.onclick = () => { close(); if (action === 'shortcuts') void import('./shortcuts').then(module => { if (parent.isConnected) closeShortcuts = module.showCodeShortcuts() }); else run(action) }; menu.append(item)
    }
    menu.addEventListener('keydown', e => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      const buttons = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], i = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus({ preventScroll: true })
    })
    menu.addEventListener('wheel', containMenuWheel, { passive: false })
    ;(more.closest('dialog') ?? document.body).append(menu)
    const popup = menu
    stopPosition = autoUpdate(more, popup, async () => {
      const box = more.getBoundingClientRect()
      const top = more.closest('dialog') ? 8 : ((document.querySelector('.yy-toolbar') ?? document.querySelector('.yy-topbar'))?.getBoundingClientRect().bottom ?? 0) + 8
      if (!more.isConnected || box.bottom <= top || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) { close(); return }
      const padding = { top, bottom: 8, left: 8, right: 8 }
      const { x, y } = await computePosition(more, popup, { strategy: 'fixed', placement: 'bottom-end', middleware: [offset(6), flip({ padding }), shift({ padding }), size({ padding, apply: ({ availableHeight }) => { popup.style.maxHeight = `${Math.max(50, availableHeight)}px` } })] })
      if (menu === popup) Object.assign(popup.style, { left: `${x}px`, top: `${y}px` })
    }, { animationFrame: true })
    more.setAttribute('aria-expanded', 'true'); menu.querySelector('button')?.focus({ preventScroll: true })
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key)
  }
  parent.append(expand, more)
  return () => { close(); closeShortcuts?.(); expand.remove(); more.remove() }
}

// Move the same code editor into a modal, keeping selection, folds and document undo intact.
export function expandCode(code: CodeEditor, title: string, onClose?: () => void, toolbar?: HTMLElement) {
  const previous = code.view.dom.parentElement!
  const oldHeight = previous.style.minHeight
  const scroll = { x: window.scrollX, y: window.scrollY, codeTop: code.view.scrollDOM.scrollTop, codeLeft: code.view.scrollDOM.scrollLeft }
  previous.style.minHeight = `${previous.getBoundingClientRect().height}px`
  const dialog = document.createElement('dialog'); dialog.className = 'yy-code-dialog'; dialog.setAttribute('aria-label', title || '代码块')
  const bar = document.createElement('div'); bar.className = 'yy-code-dialog-title'
  const label = document.createElement('strong'); label.textContent = title || '代码块'
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.dataset.tip = '关闭放大视图'; close.setAttribute('aria-label', '关闭放大视图')
  close.onclick = () => dialog.close()
  const find = document.createElement('button'); find.type = 'button'; find.textContent = '查找'; find.onclick = () => code.find()
  const wrap = document.createElement('button'); wrap.type = 'button'; wrap.textContent = '自动换行'; wrap.setAttribute('aria-pressed', String(code.preferences.wrapped)); wrap.onclick = () => { code.setWrapped(!code.preferences.wrapped); wrap.setAttribute('aria-pressed', String(code.preferences.wrapped)) }
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.dataset.tip = '复制代码'; copy.onclick = async () => { copy.textContent = await copyText(code.view.state.doc.toString()) ? '已复制' : '复制失败' }
  const toolbarParent = toolbar?.parentElement, toolbarNext = toolbar?.nextSibling ?? null
  if (toolbar) { bar.classList.add('has-editor-toolbar'); bar.append(toolbar, close) }
  else bar.append(label, find, wrap, copy, close)
  const body = document.createElement('div'); body.className = 'yy-code-editor-host yy-code-dialog-body'
  body.append(code.view.dom); dialog.append(bar, body); document.body.append(dialog)
  const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
  let closed = false
  const cleanup = () => {
    if (closed) return; closed = true
    previous.append(code.view.dom); previous.style.minHeight = oldHeight
    if (toolbar && toolbarParent) toolbarParent.insertBefore(toolbar, toolbarNext)
    document.body.style.overflow = overflow; dialog.remove()
    code.view.requestMeasure(); code.view.scrollDOM.scrollTop = scroll.codeTop; code.view.scrollDOM.scrollLeft = scroll.codeLeft
    window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' }); code.view.focus(); onClose?.()
  }
  dialog.addEventListener('close', cleanup)
  dialog.addEventListener('cancel', e => { e.preventDefault(); dialog.close() })
  dialog.showModal(); code.view.requestMeasure(); code.view.focus()
  return () => { if (dialog.open) dialog.close(); cleanup() }
}
