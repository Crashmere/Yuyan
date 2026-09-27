import type { CodeEditor } from './editor'
import { copyText } from '../shared/clipboard'

export type CodeAction = 'expand' | 'find' | 'goto' | 'fold' | 'unfold' | 'indent2' | 'indent4' | 'indenttab'

export function codeActions(parent: HTMLElement, run: (action: CodeAction) => void, editable = false) {
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
  const close = () => { menu?.remove(); menu = undefined; more.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  const outside = (e: Event) => { if (!menu?.contains(e.target as Node) && !more.contains(e.target as Node)) close() }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); more.focus() } }
  more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false')
  more.onclick = () => {
    if (menu) { close(); return }
    menu = document.createElement('div'); menu.className = 'yy-code-menu'; menu.setAttribute('role', 'menu')
    const items: [CodeAction, string][] = [['find', '在代码块中查找'], ['goto', '跳转到行'], ['fold', '折叠所有代码区域'], ['unfold', '展开所有代码区域']]
    if (editable) items.push(['indent2', '缩进：2 个空格'], ['indent4', '缩进：4 个空格'], ['indenttab', '缩进：Tab'])
    for (const [action, text] of items) {
      const item = document.createElement('button'); item.type = 'button'; item.textContent = text; item.setAttribute('role', 'menuitem')
      item.onclick = () => { close(); run(action) }; menu.append(item)
    }
    menu.addEventListener('keydown', e => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      const buttons = [...menu!.querySelectorAll('button')], i = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    })
    const box = more.getBoundingClientRect()
    ;(more.closest('dialog') ?? document.body).append(menu)
    menu.style.left = `${Math.max(8, Math.min(box.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(box.bottom + 6, innerHeight - menu.offsetHeight - 8))}px`
    more.setAttribute('aria-expanded', 'true'); menu.querySelector('button')?.focus()
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key)
  }
  parent.append(expand, more)
  return () => { close(); expand.remove(); more.remove() }
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
  const jump = document.createElement('button'); jump.type = 'button'; jump.textContent = '跳转到行'; jump.onclick = () => code.goto()
  const wrap = document.createElement('button'); wrap.type = 'button'; wrap.textContent = '自动换行'; wrap.setAttribute('aria-pressed', String(code.preferences.wrapped)); wrap.onclick = () => { code.setWrapped(!code.preferences.wrapped); wrap.setAttribute('aria-pressed', String(code.preferences.wrapped)) }
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.dataset.tip = '复制代码'; copy.onclick = async () => { copy.textContent = await copyText(code.view.state.doc.toString()) ? '已复制' : '复制失败' }
  const toolbarParent = toolbar?.parentElement, toolbarNext = toolbar?.nextSibling ?? null
  if (toolbar) { bar.classList.add('has-editor-toolbar'); bar.append(toolbar, close) }
  else bar.append(label, find, jump, wrap, copy, close)
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
