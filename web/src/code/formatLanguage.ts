// Keep capabilities separate from formatter modules so opening a menu downloads no parsers.
const formats: Record<string, string> = {
  c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp',
  csharp: 'cs', cs: 'cs', java: 'java', objectivec: 'm', protobuf: 'proto', proto: 'proto',
  javascript: 'babel', js: 'babel', jsx: 'babel', mjs: 'babel',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  json: 'json-stringify', jsonc: 'json', html: 'html', vue: 'vue',
  css: 'css', less: 'less', scss: 'scss', yaml: 'yaml', yml: 'yaml',
  markdown: 'markdown', md: 'markdown', mdx: 'mdx', graphql: 'graphql', gql: 'graphql',
  go: 'go', golang: 'go', python: 'python', py: 'python',
}
export function formatLanguage(language: string) { return formats[language.toLowerCase()] }
