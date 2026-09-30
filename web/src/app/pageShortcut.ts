// Page navigation must leave text entry, menus, dialogs and focused controls to their owners.
export function pageShortcutAllowed(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing) return false
  if (document.querySelector('[role="dialog"], [role="menu"], dialog[open]')) return false
  if (!(e.target instanceof Element)) return true
  if (e.target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="listbox"], [role="tablist"]')) return false
  return !(e.key.startsWith('Arrow') && e.target.closest('button'))
}
