// Turns the [!code] callouts that imitated Yuque's titled code blocks in Obsidian back into code
// blocks with a title bar (src/schema/codeBlock.ts, docs/DESIGN.md 16):
//   npm --prefix web run migrate-code -- --server http://127.0.0.1:18084/yuyan/ [--dry]
// --dry only reports. Otherwise each changed document is first kept as a version, so its history
// holds the callouts, then saved against the revision it was read at; a document edited meanwhile
// is left alone and reported. Running it again changes nothing.
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { codeFromCallout } from '../../src/schema/codeBlock'
import { schemaExtensions } from '../../src/schema/extensions'

interface TreeNode {
  id: number
  title: string
  children?: TreeNode[]
}

interface Doc {
  title: string
  content: JSONContent
  revision: number
}

const kinds = {
  titledCollapsed: '有标题、收起',
  titledOpen: '有标题、展开',
  untitledCollapsed: '无标题、收起（空标题栏）',
  plain: '无标题、展开（普通代码块）',
}
type Kind = keyof typeof kinds

const schema = getSchema(schemaExtensions())

function serverArg(): string {
  const i = process.argv.indexOf('--server')
  const url = i >= 0 ? process.argv[i + 1] : undefined
  if (!url) throw new Error('usage: migrate-code --server <http://host/yuyan/> [--dry]')
  return url.endsWith('/') ? url : `${url}/`
}

async function api(base: string, method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(new URL(`api/${path}`, base), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`)
  return res
}

function kindOf(code: JSONContent): Kind {
  const { title, collapsed } = code.attrs ?? {}
  if (typeof title !== 'string') return 'plain'
  if (!title) return 'untitledCollapsed'
  return collapsed ? 'titledCollapsed' : 'titledOpen'
}

// Returns the node with its code callouts converted, and counts them; a code callout holding
// anything but a single code block stays and is counted as left.
function convert(node: JSONContent, found: Kind[], left: { n: number }): JSONContent {
  if (!node.content) return node
  let changed = false
  const content = node.content.map((child) => {
    const code = codeFromCallout(child)
    if (code) {
      found.push(kindOf(code))
      changed = true
      return code
    }
    if (child.type === 'callout' && child.attrs?.type === 'code') left.n++
    const next = convert(child, found, left)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...node, content } : node
}

function nodes(tree: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of tree) {
    out.push(n)
    nodes(n.children ?? [], out)
  }
  return out
}

async function main() {
  const base = serverArg()
  const dry = process.argv.includes('--dry')
  const totals = Object.fromEntries(Object.keys(kinds).map((k) => [k, 0])) as Record<Kind, number>
  const problems: string[] = []
  let docs = 0
  let changedDocs = 0
  const books = (await (await api(base, 'GET', 'books')).json()) as { id: number; name: string }[]
  for (const book of books) {
    const tree = (await (await api(base, 'GET', `books/${book.id}/tree`)).json()) as TreeNode[]
    for (const n of nodes(tree)) {
      const d = (await (await api(base, 'GET', `docs/${n.id}`)).json()) as Doc
      docs++
      const found: Kind[] = []
      const left = { n: 0 }
      const content = convert(d.content, found, left)
      const name = `${book.name} / ${d.title}（#${n.id}）`
      if (left.n) problems.push(`${name}：${left.n} 个代码 Callout 里不只一个代码块，未转换`)
      if (!found.length) continue
      changedDocs++
      for (const k of found) totals[k]++
      const summary = (Object.keys(kinds) as Kind[])
        .map((k) => [k, found.filter((f) => f === k).length] as const)
        .filter(([, c]) => c)
        .map(([k, c]) => `${kinds[k]} ${c}`)
        .join('，')
      console.log(`- ${name}：${found.length} 个（${summary}）`)
      try {
        Node.fromJSON(schema, content).check()
      } catch (e) {
        problems.push(`${name}：转换后不符合编辑器 schema（${(e as Error).message}），未保存`)
        continue
      }
      if (dry) continue
      await api(base, 'POST', `docs/${n.id}/snapshot`)
      const res = await api(base, 'PUT', `docs/${n.id}`, { title: d.title, content, baseRevision: d.revision })
      if (res.status === 409) problems.push(`${name}：读取后被修改过，未保存，请重新运行`)
    }
  }
  const all = Object.values(totals).reduce((a, b) => a + b, 0)
  console.log(`${dry ? '演练：' : ''}检查 ${docs} 篇，${changedDocs} 篇含代码 Callout，共 ${all} 个${dry ? '将' : '已'}转换为代码块`)
  for (const k of Object.keys(kinds) as Kind[]) console.log(`  ${kinds[k]}：${totals[k]}`)
  for (const p of problems) console.log(`! ${p}`)
  if (problems.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
