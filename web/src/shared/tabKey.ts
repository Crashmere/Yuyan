// The site has no default Tab navigation. Document editors keep their own indentation and
// table commands; if an editor does not handle Tab, it must not fall back to moving focus.
export function installTabPolicy() {
  const isTab = (event: KeyboardEvent) => event.key === 'Tab' && !event.ctrlKey &&
    !event.metaKey && !event.altKey && !event.isComposing && event.keyCode !== 229
  window.addEventListener('keydown', event => {
    if (!isTab(event)) return
    const target = event.target
    if (target instanceof HTMLElement && target.isContentEditable && target.closest('.ProseMirror, .cm-content')) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  window.addEventListener('keydown', event => {
    if (isTab(event)) event.preventDefault()
  })
}
