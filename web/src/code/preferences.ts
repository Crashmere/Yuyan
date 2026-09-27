export interface CodePreferences {
  wrapped: boolean
  indent: '2' | '4' | 'tab'
  hash?: string
  folds?: { from: number; to: number }[]
}

export function codeKey(index: number) {
  return `yuyan:code:${location.pathname.replace(/\/edit\/?$/, '')}:${index}`
}

export function codeHash(text: string) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `${text.length}:${hash >>> 0}`
}

export function readCodePreferences(key: string): CodePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<CodePreferences>
    return { ...stored, wrapped: stored.wrapped === true, indent: ['2', '4', 'tab'].includes(stored.indent ?? '') ? stored.indent! : '4' }
  } catch { return { wrapped: false, indent: '4' } }
}

export function saveCodePreferences(key: string, value: CodePreferences) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* session still works without storage */ }
}
