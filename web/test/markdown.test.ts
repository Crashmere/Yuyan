import { describe, expect, it } from 'vitest'
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { docToMarkdown, markdownToDoc, normalizeLanguage } from '../src/schema/markdown'
import { schemaExtensions } from '../src/schema/extensions'

const schema = getSchema(schemaExtensions())

function valid(doc: JSONContent) {
  PMNode.fromJSON(schema, doc).check()
  return doc
}

describe('markdownToDoc', () => {
  it('turns Obsidian callouts into callout nodes with title and fold state', () => {
    const doc = valid(markdownToDoc('> [!code]- Java **实现**\n> ```java\n> int a = 1;\n> ```\n'))
    const callout = doc.content![0]
    expect(callout).toMatchObject({ type: 'callout', attrs: { type: 'code', fold: '-' } })
    expect(callout.content![0]).toEqual({
      type: 'calloutTitle',
      content: [{ type: 'text', text: 'Java ' }, { type: 'text', text: '实现', marks: [{ type: 'bold' }] }],
    })
    expect(callout.content![1].content![0]).toMatchObject({ type: 'codeBlock', attrs: { language: 'java' } })
  })

  it('keeps body text that follows the callout marker line', () => {
    const doc = valid(markdownToDoc('> [!note]\n> 第一行\n> 第二行', { breaks: true }))
    const [title, body] = doc.content![0].content!
    expect(title).toEqual({ type: 'calloutTitle' })
    expect(body.content![0].content).toEqual([
      { type: 'text', text: '第一行' },
      { type: 'hardBreak' },
      { type: 'text', text: '第二行' },
    ])
  })

  it('resolves wiki links, embeds and image sizes through the context', () => {
    const doc = valid(markdownToDoc('见 [[条款 10|赋值]] 和 ![[img-001.png|300]] ![图|200x100](a.png)', {
      resolveLink: (t) => (t === '条款 10' ? '/docs/7' : null),
      resolveImage: (t) => `/assets/${t.replace('.png', '')}.png`,
    }))
    expect(doc.content![0].content).toEqual([
      { type: 'text', text: '见 ' },
      { type: 'text', text: '赋值', marks: [{ type: 'link', attrs: { href: '/docs/7' } }] },
      { type: 'text', text: ' 和 ' },
      { type: 'image', attrs: { src: '/assets/img-001.png', alt: null, title: null, width: 300, height: null } },
      { type: 'text', text: ' ' },
      { type: 'image', attrs: { src: '/assets/a.png', alt: '图', title: null, width: 200, height: 100 } },
    ])
  })

  it('keeps html images with height side by side', () => {
    const doc = valid(markdownToDoc('<img src="a.png" height="150"><img src="b.png" height="150">'))
    expect(doc.content![0].content!.map((n) => n.attrs?.height)).toEqual([150, 150])
  })

  it('parses highlights, math, task lists and tables', () => {
    const doc = valid(markdownToDoc('==重点== 与 $a^2$\n\n- [x] 完成\n- [ ] 未完成\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n$$\nx\n$$\n'))
    expect(doc.content![0].content![0]).toEqual({ type: 'text', text: '重点', marks: [{ type: 'highlight' }] })
    expect(doc.content![0].content![2]).toEqual({ type: 'inlineMath', attrs: { latex: 'a^2' } })
    expect(doc.content![1].type).toBe('taskList')
    expect(doc.content![2].content![0].content![0].attrs?.align).toBe('left')
    expect(doc.content![3]).toEqual({ type: 'blockMath', attrs: { latex: 'x' } })
  })

  it('reports issues instead of silently dropping content', () => {
    const issues: string[] = []
    valid(markdownToDoc('a <u>b</u> c', { issue: (m) => issues.push(m) }))
    expect(issues.length).toBeGreaterThan(0)
  })
})

describe('docToMarkdown', () => {
  it('round-trips the Obsidian syntax Yuyan supports', () => {
    const md = [
      '# 标题',
      '',
      '> [!code]- Java 实现',
      '>',
      '> ```java',
      '> int a = 1;',
      '> ```',
      '',
      '==重点== 和 $a^2$ 以及 ![图|200](a.png)',
      '',
      '- [x] 完成',
      '',
      '| a | b |',
      '| :- | -: |',
      '| 1 | 2 |',
      '',
    ].join('\n')
    const doc = valid(markdownToDoc(md))
    const back = docToMarkdown(doc)
    expect(back).toContain('> [!code]- Java 实现')
    expect(back).toContain('==重点==')
    expect(back).toContain('![图|200](a.png)')
    expect(valid(markdownToDoc(back))).toEqual(doc)
  })
})

describe('normalizeLanguage', () => {
  it('cleans fence languages', () => {
    expect(normalizeLanguage('ini,')).toBe('ini')
    expect(normalizeLanguage('C++')).toBe('cpp')
    expect(normalizeLanguage('代码段')).toBe('')
  })
})
