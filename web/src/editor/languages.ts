// The languages offered for code blocks. The stored value is the id, as written after ``` in
// Markdown; aliases only help searching.
export interface Language {
  id: string
  label: string
  aliases: string[]
}

export const languages: Language[] = [
  { id: '', label: '纯文本', aliases: ['text', 'plaintext', 'txt'] },
  { id: 'bash', label: 'Bash', aliases: ['sh', 'zsh', 'shell'] },
  { id: 'c', label: 'C', aliases: ['h'] },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cc', 'hpp'] },
  { id: 'csharp', label: 'C#', aliases: ['cs'] },
  { id: 'css', label: 'CSS', aliases: [] },
  { id: 'dart', label: 'Dart', aliases: [] },
  { id: 'diff', label: 'Diff', aliases: ['patch'] },
  { id: 'dockerfile', label: 'Dockerfile', aliases: ['docker'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'graphql', label: 'GraphQL', aliases: ['gql'] },
  { id: 'groovy', label: 'Groovy', aliases: ['gradle'] },
  { id: 'html', label: 'HTML', aliases: ['htm', 'xhtml'] },
  { id: 'ini', label: 'INI', aliases: ['toml', 'conf'] },
  { id: 'java', label: 'Java', aliases: [] },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'node'] },
  { id: 'json', label: 'JSON', aliases: ['jsonc'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt'] },
  { id: 'latex', label: 'LaTeX', aliases: ['tex'] },
  { id: 'less', label: 'Less', aliases: [] },
  { id: 'lua', label: 'Lua', aliases: [] },
  { id: 'makefile', label: 'Makefile', aliases: ['make', 'mk'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md'] },
  { id: 'matlab', label: 'MATLAB', aliases: [] },
  { id: 'mermaid', label: 'Mermaid 图表', aliases: ['diagram', 'tubiao'] },
  { id: 'nginx', label: 'Nginx', aliases: [] },
  { id: 'objectivec', label: 'Objective-C', aliases: ['objc'] },
  { id: 'perl', label: 'Perl', aliases: ['pl'] },
  { id: 'php', label: 'PHP', aliases: [] },
  { id: 'powershell', label: 'PowerShell', aliases: ['ps1', 'pwsh'] },
  { id: 'properties', label: 'Properties', aliases: [] },
  { id: 'protobuf', label: 'Protocol Buffers', aliases: ['proto'] },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'r', label: 'R', aliases: [] },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'scala', label: 'Scala', aliases: [] },
  { id: 'scss', label: 'SCSS', aliases: ['sass'] },
  { id: 'sql', label: 'SQL', aliases: ['mysql', 'postgresql'] },
  { id: 'swift', label: 'Swift', aliases: [] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'] },
  { id: 'vbnet', label: 'VB.NET', aliases: ['vb'] },
  { id: 'xml', label: 'XML', aliases: ['svg', 'plist'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
]

export function languageLabel(id: string): string {
  const key = id.toLowerCase()
  return languages.find((l) => l.id === key || l.aliases.includes(key))?.label ?? id
}

export function searchLanguages(query: string, current: string): Language[] {
  const q = query.trim().toLowerCase()
  let list = languages
  if (current && !languages.some((l) => l.id === current.toLowerCase() || l.aliases.includes(current.toLowerCase()))) {
    list = [{ id: current, label: current, aliases: [] }, ...languages]
  }
  if (!q) return list
  return list.filter((l) => l.id.includes(q) || l.label.toLowerCase().includes(q) || l.aliases.some((a) => a.startsWith(q)))
}
