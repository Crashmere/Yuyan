// Fills an empty instance with synthetic sample content for trying the interface and the export:
//   npm --prefix web run seed -- --server http://127.0.0.1:18184/yuyan/
// It refuses to write into an instance that already has knowledge bases.
import { crc32, deflateSync } from 'node:zlib'
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc } from '../../src/schema/markdown'

interface SeedNode {
  title: string
  group?: boolean
  md?: string
  children?: SeedNode[]
}

interface SeedBook {
  name: string
  description: string
  nodes: SeedNode[]
}

function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const row = width * 3 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * row + 1 + x * 3)
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const images: Record<string, Buffer> = {
  'wide.png': png(960, 400, (x, y) => [40 + Math.round((x / 960) * 40), 150 + Math.round((y / 400) * 60), 120 + Math.round((x / 960) * 110)]),
  'square.png': png(320, 320, (x, y) => ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [236, 240, 238] : [0, 185, 107])),
  'diagram.png': png(640, 360, (x, y) => (Math.abs(x - 320) < 150 && Math.abs(y - 180) < 80 ? [255, 214, 102] : [244, 246, 250])),
}

const longSections = ['背景', '目标', '方案', '实现', '验证', '结论']
  .map(
    (h, i) => `## ${i + 1}. ${h}

这是一段用于检查排版的合成正文。段落需要足够长，才能看出行高、字距和段间距是否舒适；中文与 English words 混排时，标点和空格也应该自然。第 ${i + 1} 节还引用了行内代码 \`config.yaml\` 和行内公式 $E = mc^2$。

### ${i + 1}.1 细节

- 第一条要点，说明一个具体的做法
- 第二条要点，包含**加粗**、*斜体*、~~删除线~~ 和 ==高亮==
  - 嵌套的列表项
- 第三条要点

### ${i + 1}.2 小结

> 引用一段话，用来检查引用块的样式。

${'为了让页面可以滚动，这里重复一些句子。'.repeat(8)}
`,
  )
  .join('\n')

const books: SeedBook[] = [
  {
    name: '产品手册（示例）',
    description: '界面与导出的合成样例，可以随意修改和删除',
    nodes: [
      {
        title: '入门',
        group: true,
        children: [
          {
            title: '安装',
            md: `从下载到运行只需要三步。

## 下载

\`\`\`bash
curl -fsSL https://example.com/install.sh | bash
yuyan --version
\`\`\`

> [!tip] 提示
> 安装前先确认磁盘还有 1 GB 空间。

![[wide.png|640]]

## 启动

安装完成后，参考[[快速开始]]。`,
          },
          {
            title: '快速开始',
            md: `1. 新建一个知识库
2. 在目录里新建文档
3. 输入 / 插入内容

## 待办

- [x] 阅读[[安装]]
- [ ] 阅读[[配置]]
- [ ] 通读[[长文档示例]]

## 快捷输入

| 输入 | 效果 | 说明 |
| :-- | :-: | --: |
| \`#\` 加空格 | 标题 | 一到六级 |
| \`-\` 加空格 | 无序列表 | 也可以用 \`*\` |
| 三个反引号 | 代码块 | 可以跟语言名 |`,
          },
        ],
      },
      {
        title: '进阶',
        md: '这篇文档下面还有子文档：[[配置]]和[[部署]]。',
        children: [
          {
            title: '配置',
            md: `配置文件使用 YAML。

\`\`\`yaml
server:
  listen: 127.0.0.1:18084
  base: /yuyan/
\`\`\`

> [!warning]- 修改前先备份
> 配置错误会导致服务无法启动。
> \`\`\`json
> { "backup": true }
> \`\`\``,
          },
          {
            title: '部署',
            md: `\`\`\`mermaid
flowchart LR
  A[推送 main] --> B[CI 测试]
  B --> C[压缩上传]
  C --> D[健康检查]
\`\`\`

\`\`\`nginx
location ^~ /yuyan/ {
    proxy_pass http://127.0.0.1:18084/;
}
\`\`\``,
          },
        ],
      },
      {
        title: '参考',
        group: true,
        children: [
          {
            title: '长文档示例',
            md: `# 长文档示例

用来检查目录、滚动和各种内容块的显示。

> [!note] 说明
> 这篇文档包含标题、列表、表格、公式、Callout 和图片。

${longSections}

## 公式

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

## 图片

![[diagram.png|480]] ![[square.png|160]]

## 表格

| 名称 | 类型 | 默认值 |
| --- | --- | --- |
| listen | 字符串 | 127.0.0.1:18084 |
| base | 字符串 | /yuyan/ |`,
          },
          {
            title: '常见问题',
            md: `> [!question]+ 为什么图片加载慢？
> 服务器下行带宽有限，图片会长期缓存，第二次打开就快了。

> [!failure]- 保存失败怎么办？
> 内容会先保存在浏览器本地，网络恢复后自动重试。

---

> 引用块和 Callout 的样式应当能区分开。`,
          },
        ],
      },
      { title: '设计', group: true, children: [{ title: '界面规范', md: '颜色、字号和间距的约定。' }] },
      { title: '设计', md: '与分组同名的文档，用来检查导出时的文件夹笔记布局。' },
    ],
  },
  {
    name: '算法笔记（示例）',
    description: '代码与公式较多的合成样例',
    nodes: [
      {
        title: '基础',
        group: true,
        children: [
          {
            title: '排序',
            md: `快速排序的平均复杂度为 $O(n \\log n)$。

\`\`\`cpp
void quick_sort(int q[], int l, int r) {
    if (l >= r) return;
    int i = l - 1, j = r + 1, x = q[l + r >> 1];
    while (i < j) {
        do i++; while (q[i] < x);
        do j--; while (q[j] > x);
        if (i < j) std::swap(q[i], q[j]);
    }
    quick_sort(q, l, j), quick_sort(q, j + 1, r);
}
\`\`\``,
          },
          {
            title: '二分',
            md: `$$
\\text{mid} = \\left\\lfloor \\frac{l + r}{2} \\right\\rfloor
$$

\`\`\`java
int search(int[] a, int x) {
    int l = 0, r = a.length - 1;
    while (l < r) {
        int mid = (l + r) >> 1;
        if (a[mid] >= x) r = mid; else l = mid + 1;
    }
    return l;
}
\`\`\``,
          },
        ],
      },
      {
        title: '图论',
        group: true,
        children: [
          { title: '最短路', md: '> [!code]- Dijkstra\n> ```cpp\n> int dijkstra();\n> ```\n\n边权非负时使用 Dijkstra，存在负权边时使用 Bellman-Ford 或 SPFA。' },
          { title: '最小生成树', md: 'Prim 适合稠密图，Kruskal 适合稀疏图。' },
        ],
      },
      { title: '复杂度速查', md: '| 算法 | 时间 | 空间 |\n| --- | --- | --- |\n| 快速排序 | $O(n\\log n)$ | $O(\\log n)$ |\n| 二分 | $O(\\log n)$ | $O(1)$ |' },
    ],
  },
  {
    name: '读书摘录（示例）',
    description: '',
    nodes: [
      { title: '摘录一', md: '> 书是人类进步的阶梯。\n\n读后感写在这里。' },
      { title: '摘录二', md: '一段普通的读书笔记。' },
    ],
  },
  { name: '空知识库（示例）', description: '还没有文档的知识库', nodes: [] },
]

async function main() {
  const i = process.argv.indexOf('--server')
  const server = (i >= 0 ? process.argv[i + 1] : '')?.replace(/\/?$/, '/')
  if (!server || server === '/') throw new Error('usage: seed --server <http://host/yuyan/>')
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${server}api/${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.message ?? ''}`)
    return data as T
  }

  const meta = await call<{ stats: { books: number } }>('GET', 'meta')
  if (meta.stats.books > 0) throw new Error('目标实例已有知识库，示例数据只写入空实例')

  const uploaded: Record<string, string> = {}
  for (const [name, data] of Object.entries(images)) {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(data)]), name)
    const res = await fetch(`${server}api/assets`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`upload ${name}: ${res.status}`)
    uploaded[name] = ((await res.json()) as { url: string }).url
  }

  // Pass 1 creates every node so that pass 2 can turn [[title]] links into document links.
  const ids = new Map<string, number>()
  const pending: { id: number; title: string; md: string }[] = []
  for (const book of books) {
    const { id: bookId } = await call<{ id: number }>('POST', 'books', { name: book.name, description: book.description })
    const create = async (nodes: SeedNode[], parentId: number | null) => {
      for (const n of nodes) {
        const created = await call<{ id: number }>('POST', 'docs', { bookId, parentId, kind: n.group ? 'group' : 'doc', title: n.title })
        if (!n.group) {
          if (!ids.has(n.title)) ids.set(n.title, created.id)
          if (n.md) pending.push({ id: created.id, title: n.title, md: n.md })
        }
        if (n.children) await create(n.children, created.id)
      }
    }
    await create(book.nodes, null)
  }
  for (const p of pending) {
    const doc: JSONContent = markdownToDoc(p.md, {
      resolveLink: (target) => (ids.has(target) ? `/docs/${ids.get(target)}` : null),
      resolveImage: (target) => uploaded[target] ?? null,
    })
    const blocks = doc.content ?? []
    if (blocks[blocks.length - 1]?.type !== 'paragraph') doc.content = [...blocks, { type: 'paragraph' }]
    await call('PUT', `docs/${p.id}`, { title: p.title, content: doc, baseRevision: 1 })
  }
  console.log(`示例数据已写入：${books.length} 个知识库，${pending.length} 篇有正文的文档，${Object.keys(images).length} 张图片`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
