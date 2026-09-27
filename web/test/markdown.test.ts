// @vitest-environment happy-dom
// (a DOMParser, for tables written as HTML)
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
    const doc = valid(markdownToDoc('> [!tip]- Java **实现**\n> ```java\n> int a = 1;\n> ```\n'))
    const callout = doc.content![0]
    expect(callout).toMatchObject({ type: 'callout', attrs: { type: 'tip', fold: '-' } })
    expect(callout.content![0]).toEqual({
      type: 'calloutTitle',
      content: [{ type: 'text', text: 'Java ' }, { type: 'text', text: '实现', marks: [{ type: 'bold' }] }],
    })
    expect(callout.content![1].content![0]).toMatchObject({ type: 'codeBlock', attrs: { language: 'java' } })
  })

  it('reads [!code] callouts as the titled, collapsible code blocks they imitated', () => {
    const code = (md: string) => valid(markdownToDoc(md)).content![0]
    expect(code('> [!code]- 家谱树\n> ```cpp\n> int a;\n> ```\n')).toEqual({
      type: 'codeBlock',
      attrs: { language: 'cpp', title: '家谱树', collapsed: true },
      content: [{ type: 'text', text: 'int a;' }],
    })
    expect(code('> [!code]+ 展开的\n> ```cpp\n> int a;\n> ```\n').attrs).toEqual({ language: 'cpp', title: '展开的', collapsed: false })
    expect(code('> [!code]-\n> ```cpp\n> int a;\n> ```\n').attrs).toEqual({ language: 'cpp', title: '', collapsed: true })
    expect(code('> [!code]\n> ```cpp\n> int a;\n> ```\n').attrs).toEqual({ language: 'cpp', title: null, collapsed: false })
    // Anything besides one code block stays a callout.
    expect(code('> [!code] 说明\n> 先看这里\n>\n> ```cpp\n> int a;\n> ```\n').type).toBe('callout')
  })

  it('reads code block titles and collapsed state from the fence', () => {
    const block = valid(markdownToDoc("```cpp title='拓扑 \"排序\"' collapsed\nint a;\n```\n\n```py {1,3}\nx = 1\n```\n\n```go {2} title=\"x\" collapsed\ny\n```\n")).content!
    expect(block[0].attrs).toEqual({ language: 'cpp', title: '拓扑 "排序"', collapsed: true })
    expect(block[1].attrs).toEqual({ language: 'python' })
    expect(block[2].attrs).toEqual({ language: 'go', title: 'x', collapsed: true })
  })

  it('keeps any title through Markdown', () => {
    for (const title of ['家谱树', '拓扑 "排序"', `他说 "it's"`, 'C:\\path\\*', 'a\\\\b', 'A &amp; B & C', '`x`', '']) {
      const doc = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'cpp', title, collapsed: true }, content: [{ type: 'text', text: 'x' }] }] }
      expect(markdownToDoc(docToMarkdown(doc)).content![0].attrs, title).toEqual({ language: 'cpp', title, collapsed: true })
    }
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

  it('gives each text node every mark type at most once', () => {
    const doc = valid(markdownToDoc('**外层 **内层** 外层**'))
    expect(doc.content![0].content).toEqual([{ type: 'text', text: '外层 内层 外层', marks: [{ type: 'bold' }] }])
  })

  it('allows inline code to keep bold and link marks', () => {
    const doc = valid(markdownToDoc('**`main()`** 与 [`go build`](https://go.dev)'))
    const [bold, , linked] = doc.content![0].content!
    expect(bold).toEqual({ type: 'text', text: 'main()', marks: [{ type: 'bold' }, { type: 'code' }] })
    expect(linked.marks?.map((m) => m.type)).toEqual(['link', 'code'])
    expect(docToMarkdown(doc).trim()).toBe('**`main()`** 与 [`go build`](https://go.dev)')
  })

  it('keeps angle-bracket text that is not HTML', () => {
    const doc = valid(markdownToDoc('ArrayList<String> list 和 <cmd>'))
    expect(doc.content![0].content).toEqual([{ type: 'text', text: 'ArrayList<String> list 和 <cmd>' }])
  })

  it('repairs formulas the way Obsidian reads them', () => {
    const adjacent = valid(markdownToDoc('端点：$R(0)=R_0$$R(1)=R_n$'))
    expect(adjacent.content![0].content!.filter((n) => n.type === 'inlineMath').map((n) => n.attrs?.latex)).toEqual(['R(0)=R_0', 'R(1)=R_n'])
    const align = valid(markdownToDoc('> [!note]\n> $\n> \\begin{align}\n> a &= 1\n> \\end{align}\n> $'))
    expect(align.content![0].content![1].content![0]).toMatchObject({ type: 'blockMath' })
    const star = valid(markdownToDoc('$T^\\*$'))
    expect(star.content![0].content![0].attrs?.latex).toBe('T^*')
  })
})

describe('docToMarkdown', () => {
  it('preserves independent paragraph, image, table and cell alignment through HTML', () => {
    const doc = valid({ type: 'doc', content: [
      { type: 'paragraph', attrs: { textAlign: 'right' }, content: [
        { type: 'text', text: '文字 & <格式>', marks: [{ type: 'bold' }] },
        { type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: '/docs/12' } }] },
      ] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { src: '/assets/a.png', alt: 'A "quote" & B', width: 120, blockAlign: 'center' } }] },
      { type: 'table', attrs: { blockAlign: 'right' }, content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { align: 'center' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '表头' }] }] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { align: 'center', cellAlign: 'left' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '单格' }] }] }] },
      ] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '列表内的段落' }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '普通段落' }] },
    ] })
    const md = docToMarkdown(doc, { imageSrc: () => 'a.png', linkHref: () => 'next.md' })
    expect(md).toContain('text-align: right')
    expect(md).toContain('data-cell-align="left"')
    expect(md).toContain('data-column-align="center"')
    expect(md).toContain('alt="A &quot;quote&quot; &amp; B"')
    const back = valid(markdownToDoc(md, { resolveImage: () => '/assets/a.png', resolveLink: () => '/docs/12' }))
    const filled = (d: JSONContent) => PMNode.fromJSON(schema, d).toJSON()
    expect(filled(back)).toEqual(filled(doc))
  })

  it('round-trips the Obsidian syntax Yuyan supports', () => {
    const md = [
      '# 标题',
      '',
      '> [!tip]- Java 实现',
      '>',
      '> ```java',
      '> int a = 1;',
      '> ```',
      '',
      "```java title='Java \"实现\"' collapsed",
      'int b = 2;',
      '```',
      '',
      '```text title=""',
      '无语言、空标题',
      '```',
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
    expect(back).toContain('> [!tip]- Java 实现')
    expect(back).toContain("```java title='Java \"实现\"' collapsed")
    expect(back).toContain('```text title=""')
    expect(back).toContain('==重点==')
    expect(back).toContain('![图|200](a.png)')
    expect(valid(markdownToDoc(back))).toEqual(doc)
  })

  it('writes tables Markdown cannot hold as HTML and reads them back', () => {
    const cell = (type: string, content: JSONContent[], width: number): JSONContent => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: [width], align: null },
      content: [{ type: 'paragraph', content }],
    })
    const link = { type: 'text', text: '另一篇', marks: [{ type: 'link', attrs: { href: '/docs/12' } }] }
    const doc = valid({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('tableHeader', [{ type: 'text', text: '名称' }], 180), cell('tableHeader', [{ type: 'text', text: '说明' }], 360)] },
            { type: 'tableRow', attrs: { height: 64 }, content: [cell('tableCell', [{ type: 'text', text: '**不是粗体** <b>' }], 180), cell('tableCell', [link], 360)] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '表格之后' }] },
      ],
    })
    const md = docToMarkdown(doc, { linkHref: (h) => (h === '/docs/12' ? '另一篇.md' : h) })
    expect(md).toContain('<table style="width: 540px">')
    expect(md).toContain('<tr style="height: 64px">')
    expect(md).toContain('<a href="另一篇.md"')
    const back = valid(markdownToDoc(md, { resolveLink: (t) => (t === '另一篇.md' ? '/docs/12' : null) }))
    // Read through the schema, the attributes left out before come back with their defaults.
    const filled = (d: JSONContent) => PMNode.fromJSON(schema, d).toJSON()
    expect(filled(back)).toEqual(filled(doc))
  })
})

describe('normalizeLanguage', () => {
  it('cleans fence languages', () => {
    expect(normalizeLanguage('ini,')).toBe('ini')
    expect(normalizeLanguage('C++')).toBe('cpp')
    expect(normalizeLanguage('代码段')).toBe('')
  })
})
