import { isModuleLoadError, moduleLoadFailed } from './moduleLoad'

type Mermaid = typeof import('mermaid').default

let loading: Promise<Mermaid> | null = null
let theme = ''
let seq = 0

export function mermaidError(error: unknown): string {
  if (isModuleLoadError(error)) {
    moduleLoadFailed.value = true
    return '图表组件加载失败，请刷新页面后重试。'
  }
  const message = error instanceof Error ? error.message : String(error)
  const syntax = !!error && typeof error === 'object' && ('hash' in error || ('name' in error && error.name === 'UnknownDiagramError'))
  return `${syntax ? '语法有误' : '图表渲染失败'}：${message}`
}

// The page theme set in the app, or the system theme when the app follows it.
function pageTheme(): 'dark' | 'default' {
  const set = document.documentElement.dataset.theme
  const dark = set ? set === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  return dark ? 'dark' : 'default'
}

// Mermaid is large, so it is only loaded on pages that contain a diagram.
export async function renderMermaid(source: string): Promise<string> {
  loading ??= import('mermaid').then(({ default: mermaid }) => mermaid).catch(error => {
    loading = null
    throw error
  })
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
