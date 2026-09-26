type Mermaid = typeof import('mermaid').default

let loading: Promise<Mermaid> | null = null
let seq = 0

// Mermaid is large, so it is only loaded on pages that contain a diagram.
export function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
    })
    return mermaid
  })
  return loading
}

export async function renderMermaid(source: string): Promise<string> {
  const mermaid = await loadMermaid()
  const id = `yy-mermaid-${++seq}`
  try {
    const { svg } = await mermaid.render(id, source)
    return svg
  } finally {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
  }
}
