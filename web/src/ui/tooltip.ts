// One tooltip for the whole site. Buttons give their tip in data-tip; it shows after a short rest
// of the pointer, since someone who pauses on a button is not sure what it does, and switches at
// once between buttons while one is showing. Keyboard focus shows it too. Touch never does.
const delay = 300

let tip: HTMLDivElement | null = null
let target: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let hiddenAt = 0

function place(el: HTMLElement) {
  const text = el.dataset.tip
  if (!el.isConnected || !text) return
  tip ??= Object.assign(document.createElement('div'), { className: 'yy-tooltip', role: 'tooltip' })
  tip.textContent = text
  document.body.appendChild(tip)
  const r = el.getBoundingClientRect()
  const t = tip.getBoundingClientRect()
  const above = r.top - t.height - 6
  const top = above >= 4 ? above : r.bottom + 6
  const left = Math.min(Math.max(4, r.left + (r.width - t.width) / 2), innerWidth - t.width - 4)
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
}

function hide() {
  clearTimeout(timer)
  if (tip?.isConnected) {
    tip.remove()
    hiddenAt = performance.now()
  }
  target = null
}

function show(el: HTMLElement) {
  if (el === target) return
  const showing = !!tip?.isConnected
  hide()
  target = el
  timer = setTimeout(() => place(el), showing || performance.now() - hiddenAt < delay ? 0 : delay)
}

const tipped = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null)

export function installTooltips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const el = tipped(e)
    if (el) show(el)
    else hide()
  })
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) hide()
  })
  document.addEventListener('focusin', (e) => {
    const el = tipped(e)
    if (el?.matches(':focus-visible')) show(el)
  })
  document.addEventListener('focusout', hide)
  for (const type of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(type, hide, true)
}
