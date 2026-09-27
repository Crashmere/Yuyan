import { EditorState, type Extension } from '@codemirror/state'
import { ensureSyntaxTree, foldable, LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

const aliases: Record<string, string> = { cpp: 'C++', csharp: 'C#', golang: 'Go', shell: 'Shell', bash: 'Shell', sh: 'Shell', zsh: 'Shell', js: 'JavaScript', ts: 'TypeScript', py: 'Python', yml: 'YAML' }
const cache = new Map<string, Promise<Extension>>()
export function codeLanguage(name: string): Promise<Extension> {
  const key = name.toLowerCase()
  let promise = cache.get(key)
  if (!promise) {
    const description = LanguageDescription.matchLanguageName(languages, aliases[key] ?? name, false)
    promise = description ? description.load().catch(() => []) : Promise.resolve([])
    cache.set(key, promise)
  }
  return promise
}

export async function codeFolds(text: string, language: string) {
  const state = EditorState.create({ doc: text, extensions: [await codeLanguage(language)] })
  ensureSyntaxTree(state, state.doc.length, 150)
  const folds: { from: number; to: number; first: number; last: number }[] = []
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    const range = foldable(state, line.from, line.to)
    if (range) folds.push({ ...range, first: i, last: state.doc.lineAt(range.to).number })
  }
  return folds
}
