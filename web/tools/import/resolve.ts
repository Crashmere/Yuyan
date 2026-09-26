import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

export interface VaultSettings {
  root: string
  breaks: boolean
}

// FileIndex knows every file in the Obsidian repository snapshot by path and by file name.
export class FileIndex {
  readonly files: string[] = []
  readonly vaults: VaultSettings[] = []
  private byName = new Map<string, string[]>()
  private present = new Set<string>()
  private hashes = new Map<string, string>()

  constructor(readonly root: string) {
    this.walk('')
    this.vaults.sort((a, b) => b.root.length - a.root.length)
  }

  private walk(dir: string) {
    for (const entry of readdirSync(join(this.root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name === '.obsidian') this.vaults.push({ root: dir, breaks: !readStrictLineBreaks(join(this.root, rel)) })
        if (!entry.name.startsWith('.')) this.walk(rel)
      } else if (!entry.name.startsWith('.')) {
        this.files.push(rel)
        this.present.add(rel)
        const key = entry.name.toLowerCase()
        this.byName.set(key, [...(this.byName.get(key) ?? []), rel])
      }
    }
  }

  has(path: string) {
    return this.present.has(path)
  }

  named(name: string): string[] {
    return this.byName.get(name.toLowerCase()) ?? []
  }

  hash(path: string): string {
    let h = this.hashes.get(path)
    if (!h) {
      h = createHash('sha256').update(readFileSync(join(this.root, path))).digest('hex')
      this.hashes.set(path, h)
    }
    return h
  }

  vaultOf(path: string): VaultSettings | undefined {
    return this.vaults.find((v) => v.root === '' || path.startsWith(`${v.root}/`))
  }
}

function readStrictLineBreaks(obsidianDir: string): boolean {
  const file = join(obsidianDir, 'app.json')
  if (!existsSync(file)) return false
  try {
    return JSON.parse(readFileSync(file, 'utf8')).strictLineBreaks === true
  } catch {
    return false
  }
}

export type Resolution =
  | { kind: 'found'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'missing' }

// resolveFile follows Obsidian's lookup order: relative to the note, relative to the vault root,
// relative to the repository, then by file name (nearest to the note first). Several different
// files with the same name are reported instead of guessed.
export function resolveFile(
  idx: FileIndex,
  target: string,
  notePath: string,
  scope: string,
  extensions: Set<string> | null,
  override?: string,
): Resolution {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: 'external', url: target }
  if (override) return idx.has(override) ? { kind: 'found', path: override } : { kind: 'missing' }
  let clean = target.replace(/^<|>$/g, '').replace(/^\.\//, '')
  if (extensions && !extensions.has(posix.extname(clean).toLowerCase())) {
    if (extensions.has('.md')) clean += '.md'
    else return { kind: 'missing' }
  }
  const noteDir = posix.dirname(notePath)
  for (const p of [posix.join(noteDir, clean), scope ? posix.join(scope, clean) : clean, clean]) {
    const n = posix.normalize(p)
    if (idx.has(n)) return { kind: 'found', path: n }
  }
  let candidates = idx.named(posix.basename(clean))
  if (clean.includes('/')) candidates = candidates.filter((c) => c.endsWith(`/${clean}`) || c === clean)
  if (!candidates.length) return { kind: 'missing' }
  const inScope = scope ? candidates.filter((c) => c.startsWith(`${scope}/`)) : candidates
  const pool = inScope.length ? inScope : candidates
  if (pool.length === 1 || new Set(pool.map((c) => idx.hash(c))).size === 1) {
    return { kind: 'found', path: nearest(pool, noteDir) }
  }
  return { kind: 'ambiguous', candidates: pool }
}

function nearest(paths: string[], dir: string): string {
  const score = (p: string) => {
    const a = posix.dirname(p).split('/')
    const b = dir.split('/')
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return a.length + b.length - 2 * i
  }
  return [...paths].sort((x, y) => score(x) - score(y) || x.localeCompare(y))[0]
}
