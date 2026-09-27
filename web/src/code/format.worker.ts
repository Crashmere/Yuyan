import { formatLanguage } from './formatLanguage'

async function format(source: string, language: string) {
  const parser = formatLanguage(language)
  if (!parser) throw new Error('当前语言暂不支持格式化')
  if (['c', 'cpp', 'cs', 'java', 'm', 'proto'].includes(parser)) {
    const clang = await import('@wasm-fmt/clang-format/vite')
    await clang.default()
    return clang.format(source, `code.${parser}`, JSON.stringify({ BasedOnStyle: 'LLVM', IndentWidth: 4, TabWidth: 4, UseTab: 'Never', ColumnLimit: 100 }))
  }
  if (parser === 'go') {
    const go = await import('@wasm-fmt/gofmt/vite')
    await go.default()
    const formatted = go.format(source)
    const { parser: grammar } = await import('@lezer/go')
    const strings: { from: number; to: number }[] = []
    grammar.parse(formatted).iterate({ enter: node => { if (node.name === 'String') strings.push({ from: node.from, to: node.to }) } })
    // gofmt uses tabs for indentation. Render them as the app's four spaces, while keeping
    // multiline raw-string contents byte-for-byte intact.
    return formatted.replace(/^\t+/gm, (tabs, at: number) => strings.some(string => string.from <= at && at < string.to) ? tabs : '    '.repeat(tabs.length))
  }
  if (parser === 'python') {
    const python = await import('@wasm-fmt/ruff_fmt/vite')
    await python.default()
    return python.format(source, 'code.py', { indent_style: 'space', indent_width: 4, line_width: 100 })
  }
  const prettier = await import('prettier/standalone')
  const plugins = []
  if (['babel', 'typescript', 'json', 'json-stringify'].includes(parser)) {
    plugins.push(await import('prettier/plugins/estree'))
    plugins.push(parser === 'typescript' ? await import('prettier/plugins/typescript') : await import('prettier/plugins/babel'))
  } else if (['html', 'vue'].includes(parser)) {
    plugins.push(await import('prettier/plugins/html'), await import('prettier/plugins/babel'), await import('prettier/plugins/estree'), await import('prettier/plugins/typescript'), await import('prettier/plugins/postcss'))
  } else if (['css', 'less', 'scss'].includes(parser)) plugins.push(await import('prettier/plugins/postcss'))
  else if (parser === 'yaml') plugins.push(await import('prettier/plugins/yaml'))
  else if (parser === 'graphql') plugins.push(await import('prettier/plugins/graphql'))
  else plugins.push(await import('prettier/plugins/markdown'), await import('prettier/plugins/babel'), await import('prettier/plugins/estree'))
  return prettier.format(source, { parser, plugins, tabWidth: 4, useTabs: false, printWidth: 100 })
}

self.onmessage = async ({ data }: MessageEvent<{ id: number; source: string; language: string }>) => {
  try { self.postMessage({ id: data.id, source: await format(data.source, data.language) }) }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const loading = /fetch|import|network|load|WebAssembly/i.test(message)
    self.postMessage({ id: data.id, error: loading ? '格式化工具加载失败，请重试' : '无法格式化，请检查代码语法' })
  }
}
