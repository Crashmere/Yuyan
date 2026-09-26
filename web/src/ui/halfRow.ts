import type { Directive } from 'vue'

// A menu longer than its maximum height scrolls, which is easy to miss where scroll bars stay
// hidden (macOS). This shortens such a menu a little, so the last item in view shows only its
// upper half. Used on the menu content components; el may be the menu or wrap it.
export const vHalfRow: Directive<HTMLElement> = {
  mounted(el) {
    // After the menu has been positioned and given the height available below its trigger.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const menu = el.classList.contains('yy-menu') ? el : el.querySelector<HTMLElement>('.yy-menu')
        if (menu) halfRow(menu)
      }),
    )
  },
}

// Offsets rather than bounding boxes, which the opening animation scales.
function halfRow(menu: HTMLElement) {
  const visible = menu.clientHeight
  if (menu.scrollHeight <= visible) return
  const items = [...menu.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.getAttribute('role')?.startsWith('menuitem'))
  const cut = items.findIndex((it) => it.offsetTop + it.offsetHeight > visible)
  if (cut < 0) return
  const middle = (it: HTMLElement) => it.offsetTop + it.offsetHeight / 2
  const at = middle(items[cut]) <= visible ? middle(items[cut]) : cut > 0 ? middle(items[cut - 1]) : 0
  if (!at) return
  const style = getComputedStyle(menu)
  menu.style.maxHeight = `${at + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`
}
