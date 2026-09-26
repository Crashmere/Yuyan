type Mermaid = typeof import('mermaid').default

let loading: Promise<Mermaid> | null = null
let theme = ''
let seq = 0

// The page theme set in the app, or the system theme when the app follows it.
function pageTheme(): 'dark' | 'default' {
  const set = document.documentElement.dataset.theme
  const dark = set ? set === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  return dark ? 'dark' : 'default'
}

// Mermaid is large, so it is only loaded on pages that contain a diagram.
export async function renderMermaid(source: string): Promise<string> {
  loading ??= import('mermaid').then(({ default: mermaid }) => mermaid)
  const mermaid = await loading
  if (theme !== pageTheme()) {
    theme = pageTheme()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme as 'dark' | 'default' })
  }
  const id = `yy-mermaid-${++seq}`
  try {
    const { svg } = await mermaid.render(id, source)
    return svg
  } finally {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
  }
}
