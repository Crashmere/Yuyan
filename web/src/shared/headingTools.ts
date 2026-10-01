export const headingSelector = 'h1, h2, h3, h4, h5, h6'

// Same identifiers as internal/render/render.go, so reading and editing share saved folds.
export function headingIds(texts: string[]): string[] {
  const seen = new Map<string, number>()
  return texts.map(text => {
    let slug = '', dash = false
    for (const c of text.toLowerCase()) {
      if (/[\p{L}\p{Nd}]/u.test(c)) { slug += c; dash = false }
      else if (/[\s_-]/u.test(c) && slug && !dash) { slug += '-'; dash = true }
    }
    slug = slug.replace(/-$/, '') || 'section'
    const n = seen.get(slug) ?? 0
    seen.set(slug, n + 1)
    return n ? `${slug}-${n}` : slug
  })
}

export function updateHeadingControl(control: HTMLElement, folded: boolean) {
  const label = folded ? '展开这一节' : '折叠这一节'
  control.setAttribute('aria-expanded', String(!folded))
  control.setAttribute('aria-label', label)
  control.dataset.tip = label
}

export function headingControl(level: number, folded?: boolean): HTMLElement {
  const control = document.createElement(folded === undefined ? 'span' : 'button')
  control.className = 'yy-heading-tools'
  control.contentEditable = 'false'
  const marker = document.createElement('span')
  marker.className = 'yy-heading-level'; marker.dataset.level = String(level); marker.setAttribute('aria-hidden', 'true')
  control.append(marker)
  if (control instanceof HTMLButtonElement) {
    control.type = 'button'; control.classList.add('yy-fold'); updateHeadingControl(control, !!folded)
  } else control.setAttribute('aria-hidden', 'true')
  return control
}

export function readHeadingFolds(key?: string): Set<string> {
  try { const value: unknown = key ? JSON.parse(localStorage.getItem(`yuyan:folds:${key}`) ?? '[]') : []; return new Set(Array.isArray(value) ? value.filter(v => typeof v === 'string') : []) }
  catch { return new Set() }
}

export function saveHeadingFolds(key: string | undefined, ids: string[]) {
  if (!key) return
  try {
    if (ids.length) localStorage.setItem(`yuyan:folds:${key}`, JSON.stringify(ids))
    else localStorage.removeItem(`yuyan:folds:${key}`)
  } catch { /* Folding remains available when browser storage is disabled. */ }
}
