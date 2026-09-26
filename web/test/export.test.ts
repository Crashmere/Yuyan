import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { encodeLinkPath, exportDoc, fileName, planExport, relativePath, type ExportBook } from '../src/shared/export'

const asset = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'

const books: ExportBook[] = [
  {
    id: 1,
    name: '设计模式',
    tree: [
      { id: 10, kind: 'group', title: '创建型模式', children: [{ id: 11, kind: 'doc', title: '单例' }] },
      { id: 12, kind: 'doc', title: '创建型模式' },
      { id: 13, kind: 'doc', title: '结构型模式', children: [{ id: 14, kind: 'doc', title: '代理' }] },
      { id: 15, kind: 'doc', title: 'A/B 测试' },
      { id: 16, kind: 'doc', title: '单例' },
      { id: 17, kind: 'doc', title: '单例' },
      { id: 18, kind: 'doc', title: 'readme' },
      { id: 19, kind: 'doc', title: 'README' },
    ],
  },
  { id: 2, name: 'attachments', tree: [{ id: 20, kind: 'group', title: '空分组' }] },
]

describe('fileName', () => {
  it('replaces characters that file systems reject and trims what Windows drops', () => {
    expect(fileName('A/B: "测试"?')).toBe('A_B_ _测试__')
    expect(fileName('  .gitignore 说明. ')).toBe('_gitignore 说明')
    expect(fileName('   ')).toBe('未命名')
  })

  it('keeps names under 200 bytes without splitting characters', () => {
    const name = fileName('长'.repeat(100))
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200)
    expect(name).toBe('长'.repeat(66))
  })
})

describe('planExport', () => {
  const plan = planExport(books)

  it('writes a group and a document of the same name side by side, as Obsidian had them', () => {
    expect(plan.entries.get(10)?.dir).toBe('设计模式/创建型模式')
    expect(plan.entries.get(11)?.file).toBe('设计模式/创建型模式/单例.md')
    expect(plan.entries.get(12)?.file).toBe('设计模式/创建型模式.md')
  })

  it('gives a document with children both a file and a folder', () => {
    expect(plan.entries.get(13)).toMatchObject({ file: '设计模式/结构型模式.md', dir: '设计模式/结构型模式' })
    expect(plan.entries.get(14)?.file).toBe('设计模式/结构型模式/代理.md')
  })

  it('numbers siblings whose names collide, ignoring case', () => {
    expect(plan.entries.get(16)?.file).toBe('设计模式/单例.md')
    expect(plan.entries.get(17)?.file).toBe('设计模式/单例 (2).md')
    expect(plan.entries.get(19)?.file).toBe('设计模式/README (2).md')
    expect(plan.renamed).toContainEqual({ book: '设计模式', title: 'A/B 测试', name: 'A_B 测试' })
  })

  it('keeps knowledge base folders away from the attachments folder', () => {
    expect(plan.entries.get(20)?.dir).toBe('attachments (2)/空分组')
    expect(plan.dirs).toContain('attachments (2)/空分组')
  })
})

describe('relativePath', () => {
  it('walks up to the common folder', () => {
    expect(relativePath('a/b/x.md', 'a/b/y.md')).toBe('y.md')
    expect(relativePath('a/b/x.md', 'a/z.md')).toBe('../z.md')
    expect(relativePath('a/b/x.md', 'attachments/i.png')).toBe('../../attachments/i.png')
    expect(relativePath('a/b/x.md', 'a/b')).toBe('.')
  })
})

describe('exportDoc', () => {
  it('points images and document links at the exported files', () => {
    const plan = planExport(books)
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '代理', marks: [{ type: 'link', attrs: { href: '/docs/14' } }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: '旧文', marks: [{ type: 'link', attrs: { href: '/docs/999' } }] },
            { type: 'text', text: ' ' },
            { type: 'image', attrs: { src: `/assets/${asset}`, alt: '图', width: 300 } },
          ],
        },
      ],
    }
    const out = exportDoc(content, plan.entries.get(11)!.file!, plan)
    expect(out.markdown.trim()).toBe(`[代理](../结构型模式/代理.md) [旧文](/docs/999) ![图|300](../../attachments/${asset})`)
    expect(out.assets).toEqual([asset])
    expect(out.missingLinks).toEqual(['/docs/999'])
  })

  it('encodes spaces and brackets the way Obsidian writes Markdown links', () => {
    expect(encodeLinkPath('../A_B 测试 (1).md')).toBe('../A_B%20测试%20%281%29.md')
  })
})
