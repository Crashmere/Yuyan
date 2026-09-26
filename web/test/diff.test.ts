import { describe, expect, it } from 'vitest'
import { counts, fold, inlineDiff, lineDiff, titleDiff, type Line, type Part } from '../src/app/versions/diff'
import { docToMarkdown, markdownToDoc } from '../src/schema/markdown'

// Lines as text: unchanged lines indented, removed ones after "-" with changed words in [ ],
// added ones after "+" with changed words in { }.
function show(lines: Line[]): string[] {
  return lines.map((l) => {
    if (l.kind === 'same') return `  ${l.text}`
    const [open, close] = l.kind === 'removed' ? ['[', ']'] : ['{', '}']
    return `${l.kind === 'removed' ? '-' : '+'} ${marked(l.parts, open, close)}`
  })
}

function marked(parts: Part[], open = '[', close = ']'): string {
  return parts.map((p) => (p.changed ? open + p.text + close : p.text)).join('')
}

describe('lineDiff', () => {
  it('marks the changed characters of an edited Chinese line and the words of an English one', () => {
    expect(show(lineDiff('# 标题\n\n我今天去了商店\n\nThe quick brown fox\n', '# 标题\n\n我明天去了超市\n\nThe quick red fox\n'))).toEqual([
      '  # 标题',
      '  ',
      '- 我[今]天去了[商店]',
      '+ 我{明}天去了{超市}',
      '  ',
      '- The quick [brown] fox',
      '+ The quick {red} fox',
    ])
  })

  it('shows inserted paragraphs as added, and pairs an edited line past them', () => {
    expect(show(lineDiff('第一段\n\n第二段内容\n', '第一段\n\n新加的一段\n\n第二段的内容\n'))).toEqual([
      '  第一段',
      '  ',
      '+ 新加的一段',
      '+ ',
      '- 第二段内容',
      '+ 第二段{的}内容',
    ])
  })

  it('pairs the most similar lines: after a deleted list item, the renumbered next item', () => {
    expect(show(lineDiff('1. 下载安装包\n2. 双击运行安装程序\n3. 按提示完成安装\n', '1. 下载安装包\n2. 按提示完成安装\n'))).toEqual([
      '  1. 下载安装包',
      '- 2. 双击运行安装程序',
      '- [3]. 按提示完成安装',
      '+ {2}. 按提示完成安装',
    ])
  })

  it('compares tables row by row, without column padding changing every row', () => {
    const table = (rows: string) => docToMarkdown(markdownToDoc(`| 参数 | 说明 |\n| --- | --- |\n${rows}`), { alignTables: false })
    expect(show(lineDiff(table('| port | 端口 |'), table('| port | 监听端口 |\n| data | 数据目录 |'))).filter((l) => !l.startsWith(' '))).toEqual([
      '- | port | 端口 |',
      '+ | port | {监听}端口 |',
      '+ | data | 数据目录 |',
    ])
  })

  it('shows a rewritten line whole instead of marking chance matches', () => {
    expect(show(lineDiff('这是一个测试\n', '那是两个例子\n'))).toEqual(['- 这是一个测试', '+ 那是两个例子'])
  })

  it('handles empty documents on either side', () => {
    expect(show(lineDiff('', '新内容\n'))).toEqual(['+ 新内容'])
    expect(show(lineDiff('旧内容\n', ''))).toEqual(['- 旧内容'])
    expect(lineDiff('', '')).toEqual([])
  })

  it('counts added and removed lines with text', () => {
    expect(counts(lineDiff('a\n\nb\n', 'a\n\nc\n\nd\n'))).toEqual({ added: 2, removed: 1 })
  })
})

describe('inlineDiff', () => {
  it('keeps changes in whitespace visible', () => {
    const [before, after] = inlineDiff('  return x', '    return x')!
    expect(marked(before)).toBe('[  ]return x')
    expect(marked(after)).toBe('[    ]return x')
  })

  it('gives up on lines with little in common', () => {
    expect(inlineDiff('完全不同的一句话', 'Something else entirely')).toBeNull()
  })
})

describe('titleDiff', () => {
  it('marks the changed words, or the whole title when nothing is kept', () => {
    expect(titleDiff('同一个标题', '同一个标题')).toBeNull()
    expect(titleDiff('读书笔记', '读书摘录')!.map((p) => marked(p))).toEqual(['读书[笔记]', '读书[摘录]'])
    expect(titleDiff('草稿', 'Notes')!.map((p) => marked(p))).toEqual(['[草稿]', '[Notes]'])
  })
})

describe('fold', () => {
  const lines = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

  it('keeps two lines of context around each change and folds the rest', () => {
    const before = [...lines(10, 'a'), 'old', ...lines(10, 'b')].join('\n\n') + '\n'
    const after = before.replace('old', 'new')
    const blocks = fold(lineDiff(before, after))
    expect(blocks.map((b) => b.kind)).toEqual(['gap', 'lines', 'gap'])
    expect(show(blocks[1].lines)).toEqual(['  a9', '  ', '  a10', '  ', '- old', '+ new', '  ', '  b1', '  ', '  b2'])
    expect(blocks[0].start).toBe(0)
    expect(blocks[2].start).toBe(blocks[1].start + blocks[1].lines.length)
    expect(blocks.flatMap((b) => b.lines)).toHaveLength(lineDiff(before, after).length)
  })

  it('shows short unchanged runs between changes instead of folding them', () => {
    const blocks = fold(lineDiff('x\na\nb\nc\ny\n', 'X\na\nb\nc\nY\n'))
    expect(blocks.map((b) => b.kind)).toEqual(['lines'])
  })
})
