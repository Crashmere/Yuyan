import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { markdownToDoc } from '../src/schema/markdown'

// Editor interactions (docs/DESIGN.md 12.6 and 12.7). Each test writes its own document into the
// synthetic 读书摘录 knowledge base, which the smoke tests leave alone.

const bookName = '读书摘录（示例）'

async function createDoc(request: APIRequestContext, title: string, md = '', images: Record<string, string> = {}): Promise<number> {
  const books = (await (await request.get('api/books')).json()) as { id: number; name: string }[]
  const book = books.find((b) => b.name === bookName)!
  const created = (await (await request.post('api/docs', { data: { bookId: book.id, parentId: null, kind: 'doc', title } })).json()) as { id: number }
  if (md) {
    const content = markdownToDoc(md, { resolveLink: () => null, resolveImage: (target) => images[target] ?? null })
    const blocks = content.content ?? []
    if (blocks[blocks.length - 1]?.type !== 'paragraph') content.content = [...blocks, { type: 'paragraph' }]
    const res = await request.put(`api/docs/${created.id}`, { data: { title, content, baseRevision: 1 } })
    expect(res.ok()).toBeTruthy()
  }
  return created.id
}

// A PNG drawn in the page, as bytes.
async function pngBytes(page: Page, width = 400, height = 240): Promise<Buffer> {
  const url = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      g.fillStyle = '#4caf50'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#fff'
      g.fillRect(w / 4, h / 4, w / 2, h / 2)
      return c.toDataURL('image/png')
    },
    [width, height],
  )
  return Buffer.from(url.split(',')[1], 'base64')
}

async function uploadImage(page: Page, request: APIRequestContext): Promise<string> {
  const res = await request.post('api/assets', { multipart: { file: { name: 'e2e.png', mimeType: 'image/png', buffer: await pngBytes(page) } } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { url: string }).url
}

// The editor moves the focus into the document (or the empty title) once it has loaded; tests
// start after that, so the caret they place stays where they put it.
async function openEditor(page: Page, id: number) {
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.yy-toolbar')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror, .yy-title-input')))
    .toBe(true)
}

// Leaves the editor through 完成, which waits for the save, then downloads the document's export
// from its menu in the tree and returns the Markdown.
async function finishAndExport(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.locator('.yy-doc-title')).toHaveText(title)
  const download = page.waitForEvent('download')
  await page.locator('.yy-sidebar .yy-tree-row', { hasText: title }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '导出' }).click()
  const file = await download
  const data = await file.createReadStream().then(async (s) => {
    const parts: Buffer[] = []
    for await (const p of s) parts.push(p as Buffer)
    return Buffer.concat(parts)
  })
  if (!file.suggestedFilename().endsWith('.zip')) return data.toString('utf8')
  const entries = unzipSync(new Uint8Array(data))
  return strFromU8(entries[`${title}.md`])
}

type EditorElement = HTMLElement & { editor: { view: { domAtPos: (p: number) => { node: Node } }; state: { selection: { from: number; to: number } } } }

// Selections made through the DOM reach the editor with the next selectionchange event, so both
// helpers wait until the editor has taken them before the test types. They set the selection
// again while waiting: a focus command from the previous step (Tiptap focuses a frame later)
// writes the editor's own selection back into the DOM.
async function selectText(page: Page, locator: ReturnType<Page['locator']>, text: string) {
  await locator.evaluate(async (el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(t)
      if (i < 0) continue
      const { editor } = document.querySelector<EditorElement>('.ProseMirror')!
      for (let k = 0; k < 40; k++) {
        getSelection()!.setBaseAndExtent(n, i, n, i + t.length)
        await new Promise((r) => setTimeout(r, 25))
        if (editor.state.selection.to - editor.state.selection.from === t.length) return
      }
      throw new Error('the editor did not take the selection')
    }
    throw new Error(`text not found: ${t}`)
  }, text)
}

// Puts the caret after the last character inside the element, e.g. at the end of a code block, or
// into an empty paragraph.
async function caretAtEnd(locator: ReturnType<Page['locator']>) {
  await locator.evaluate(async (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let last: Node | null = null
    for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n
    const { editor } = document.querySelector<EditorElement>('.ProseMirror')!
    for (let k = 0; k < 40; k++) {
      if (last) getSelection()!.setBaseAndExtent(last, last.textContent!.length, last, last.textContent!.length)
      else getSelection()!.collapse(el, 0)
      await new Promise((r) => setTimeout(r, 25))
      const { from, to } = editor.state.selection
      if (from === to && el.contains(editor.view.domAtPos(from).node)) return
    }
    throw new Error('the editor did not take the caret')
  })
}

// Clicks an element and waits until the editor's selection is inside it.
async function place(locator: ReturnType<Page['locator']>) {
  await locator.click()
  await expect
    .poll(() =>
      locator.evaluate((el) => {
        const { editor } = document.querySelector<EditorElement>('.ProseMirror')!
        return el.contains(editor.view.domAtPos(editor.state.selection.from).node)
      }),
    )
    .toBe(true)
}

const textBubble = (page: Page) => page.locator('.yy-bubble:not(.yy-table-toolbar):not(.yy-image-toolbar)')

test('the toolbars format the selection and show what is applied', async ({ page, request }) => {
  const id = await createDoc(request, '格式测试', '这一句需要加粗，这一句保持原样。')
  await openEditor(page, id)
  const para = page.locator('.ProseMirror p').first()
  await para.click()
  await selectText(page, para, '这一句需要加粗')
  await expect(textBubble(page)).toBeVisible()
  await textBubble(page).locator('[data-tip^="粗体"]').click()
  await expect(para.locator('strong')).toHaveText('这一句需要加粗')
  await expect(page.locator('.yy-toolbar [aria-label^="粗体"]')).toHaveClass(/active/)

  // The style list in the selection toolbar turns the paragraph into a heading.
  await textBubble(page).locator('.yy-bubble-select').click()
  await textBubble(page).locator('.yy-bubble-list button', { hasText: '标题 2' }).click()
  await expect(page.locator('.ProseMirror h2')).toContainText('这一句需要加粗')
  await expect(page.locator('.yy-toolbar .yy-toolbar-select').first()).toHaveText('标题 2')
})

test('the slash menu finds items by pinyin and inserts a table sized on the grid', async ({ page, request }) => {
  const id = await createDoc(request, '表格测试', '下面是表格：')
  await openEditor(page, id)
  await caretAtEnd(page.locator('.ProseMirror p').first())
  await page.keyboard.press('Enter')
  await page.keyboard.type('/bg')
  await expect(page.locator('.yy-slash .yy-slash-title')).toHaveText(['表格'])
  await page.keyboard.press('Enter')
  const cell = page.locator('.yy-table-grid [aria-label="3 行 4 列"]')
  await cell.hover()
  await expect(page.locator('.yy-table-grid-label')).toContainText('3 行 × 4 列')
  await cell.click()

  const table = page.locator('.ProseMirror table')
  const rows = table.locator('tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.first().locator('th')).toHaveCount(4)
  await page.keyboard.type('名称')

  // Table tools: insert a row, centre a column, delete another column.
  await place(rows.nth(1).locator('td').nth(1))
  const tools = page.locator('.yy-table-toolbar')
  await expect(tools).toBeVisible()
  await tools.getByRole('button', { name: '在下方插入行' }).click()
  await expect(rows).toHaveCount(4)
  await tools.getByRole('button', { name: '整列居中' }).click()
  for (const row of await rows.all()) await expect(row.locator('th, td').nth(1)).toHaveCSS('text-align', 'center')
  await place(rows.nth(1).locator('td').nth(3))
  await tools.getByRole('button', { name: '删除列' }).click()
  await expect(rows.first().locator('th')).toHaveCount(3)

  // A row inserted above the header becomes the header, and deleting the header row promotes the
  // next one: Markdown has exactly one header row.
  await place(rows.first().locator('th').first())
  await tools.getByRole('button', { name: '在上方插入行' }).click()
  await expect(rows.first().locator('th')).toHaveCount(3)
  await expect(rows.nth(1).locator('th')).toHaveCount(0)
  await expect(rows.nth(1).locator('td').first()).toHaveText('名称')
  await place(rows.first().locator('th').first())
  await tools.getByRole('button', { name: '删除行' }).click()
  await expect(rows.first().locator('th').first()).toHaveText('名称')

  const md = await finishAndExport(page, '表格测试')
  expect(md).toMatch(/\| 名称 \|\s+\|\s+\|/)
  expect(md).toMatch(/\| -+ \| :-+: \| -+ \|/)
})

test('links: from the selection toolbar and the slash menu, with a card under the cursor', async ({ page, request }) => {
  const id = await createDoc(request, '链接测试', '访问示例网站了解更多。')
  await openEditor(page, id)
  const para = page.locator('.ProseMirror p').first()
  await para.click()
  await selectText(page, para, '示例网站')
  await textBubble(page).locator('[data-tip="链接"]').click()
  const panel = page.locator('.yy-link-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('input')).toBeFocused()
  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  await expect(panel).toHaveCount(0)
  const link = page.locator('.ProseMirror a[href="https://example.com"]')
  await expect(link).toHaveText('示例网站')
  await link.click()
  await expect(page.locator('.yy-link-card')).toContainText('https://example.com')

  // Without a selection the slash menu's 链接 asks for the text too.
  await caretAtEnd(para)
  await page.keyboard.press('Enter')
  await page.keyboard.type('/lj')
  await expect(page.locator('.yy-slash .yy-slash-title')).toHaveText(['链接'])
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await panel.locator('input').nth(0).fill('帮助文档')
  await panel.locator('input').nth(1).fill('example.org/help')
  await panel.locator('input').nth(1).press('Enter')
  await expect(page.locator('.ProseMirror a[href="https://example.org/help"]')).toHaveText('帮助文档')
})

// The texts highlighted in the page for what was searched for, with where they are on screen.
function searchHighlights(page: Page) {
  return page.evaluate(() =>
    [...(CSS.highlights.get('yy-search') ?? [])].map((r) => {
      const box = (r as Range).getBoundingClientRect()
      return { text: r.toString(), top: box.top, bottom: box.bottom }
    }),
  )
}

test('Cmd/Ctrl+K opens the search panel: recent documents, knowledge bases, titles by pinyin, full text', async ({ page, request }) => {
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '算法笔记（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '排序' }).click()
  await expect(page.locator('.yy-doc-title')).toHaveText('排序')
  await page.keyboard.press('ControlOrMeta+k')
  const panel = page.locator('.yy-search-panel')
  const input = panel.locator('input')
  await expect(input).toBeFocused()
  await expect(panel.locator('.yy-search-section').first()).toHaveText('最近浏览')
  await expect(panel.locator('.yy-search-item').first()).toContainText('排序')

  await page.keyboard.type('长文档')
  await expect(panel.locator('.yy-search-item').first()).toContainText('长文档示例')
  await input.fill('ksks')
  await expect(panel.locator('.yy-search-item').first()).toContainText('快速开始')
  await input.fill('zdl')
  await expect(panel.locator('.yy-search-item').first()).toContainText('最短路')
  await input.fill('zuiduanlu')
  await expect(panel.locator('.yy-search-item').first()).toContainText('最短路')
  await input.fill('kuaisuks')
  await expect(panel.locator('.yy-search-item').first()).toContainText('快速开始')
  await input.fill('suanfabiji')
  await expect(panel.locator('.yy-search-section').first()).toHaveText('知识库')
  await expect(panel.locator('.yy-search-item').first()).toContainText('算法笔记（示例）')
  // Full-text results open with the query highlighted.
  await input.fill('Bellman')
  await expect(panel.locator('.yy-search-item', { hasText: '最短路' }).locator('.yy-search-snippet mark')).toHaveText('Bellman')
  await page.keyboard.press('Enter')
  await expect(page.locator('.yy-doc-title')).toHaveText('最短路')
  await expect(panel).toHaveCount(0)
  await expect(page).toHaveURL(/[?&]hl=Bellman/)
  await expect.poll(async () => (await searchHighlights(page)).map((h) => h.text)).toEqual(['Bellman'])

  await page.keyboard.press('ControlOrMeta+k')
  await input.fill('读书')
  await expect(panel.locator('.yy-search-item').first()).toContainText('读书摘录（示例）')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/books\/\d+$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('读书摘录（示例）')

  // In the editor the shortcut opens search too; links come from the toolbars and the slash menu.
  const id = await createDoc(request, '快捷键测试', '正文')
  await openEditor(page, id)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(panel).toBeVisible()
  await expect(page.locator('.yy-link-panel')).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('formulas are written in a popover with a live preview', async ({ page, request }) => {
  const id = await createDoc(request, '公式测试', '公式如下：')
  await openEditor(page, id)
  await caretAtEnd(page.locator('.ProseMirror p').first())
  await page.keyboard.press('Enter')
  await page.keyboard.type('$$ ')
  const panel = page.locator('.yy-math-panel')
  await expect(panel).toBeVisible()
  await page.keyboard.type('\\frac{a}{b}')
  await expect(panel.locator('.yy-math-preview .katex')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.ProseMirror [data-type="block-math"]')).toHaveAttribute('data-latex', '\\frac{a}{b}')

  // Esc on a new, empty formula leaves nothing behind.
  await caretAtEnd(page.locator('.ProseMirror p').last())
  await page.keyboard.type('$$ ')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.ProseMirror [data-type="block-math"]')).toHaveCount(1)
})

test('find and replace, and the shortcut list', async ({ page, request }) => {
  const id = await createDoc(request, '查找测试', '苹果和香蕉，苹果和橙子。')
  await openEditor(page, id)
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press('ControlOrMeta+f')
  const find = page.locator('.yy-find')
  await expect(find).toBeVisible()
  await page.keyboard.type('苹果')
  await expect(find.locator('.yy-find-status')).toHaveText('1 / 2')
  await expect(page.locator('.ProseMirror .yy-find-match')).toHaveCount(2)
  await find.locator('input').nth(1).fill('梨')
  await find.getByRole('button', { name: '全部替换' }).click()
  await expect(page.locator('.ProseMirror p').first()).toHaveText('梨和香蕉，梨和橙子。')
  await page.keyboard.press('Escape')
  await expect(find).toHaveCount(0)

  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press('ControlOrMeta+/')
  await expect(page.locator('.yy-shortcuts')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.yy-shortcuts')).toHaveCount(0)
})

test('Chinese input methods work for text, the slash menu and Markdown shortcuts', async ({ page, request }) => {
  const id = await createDoc(request, '输入法测试', '开始')
  await openEditor(page, id)
  const editor = page.locator('.ProseMirror')
  await caretAtEnd(editor.locator('p').first())
  await page.keyboard.press('Enter')
  const cdp = await page.context().newCDPSession(page)
  const compose = async (steps: string[], commit: string) => {
    for (const s of steps) await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length })
    await cdp.send('Input.insertText', { text: commit })
  }

  await compose(['n', 'ni', 'nih', 'niha', 'nihao'], '你好')
  await expect(editor.locator('p').nth(1)).toHaveText('你好')
  await expect(textBubble(page)).toHaveCount(0)

  // An input method types 、 for the / key; the menu then filters by what is composed.
  await page.keyboard.press('Enter')
  await cdp.send('Input.insertText', { text: '、' })
  await expect(page.locator('.yy-slash')).toBeVisible()
  await compose(['b', 'bi', 'bia', 'biao'], '表格')
  await expect(page.locator('.yy-slash .yy-slash-title')).toHaveText(['表格'])
  await page.keyboard.press('Escape')
  await expect(page.locator('.yy-slash')).toHaveCount(0)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')

  // Full-width symbols from an input method start Markdown blocks too.
  await cdp.send('Input.insertText', { text: '＃' })
  await page.keyboard.press(' ')
  await compose(['biao', 'biaoti'], '标题')
  await expect(editor.locator('h1')).toHaveText('标题')
  await page.keyboard.press('Enter')
  await cdp.send('Input.insertText', { text: '》' })
  await page.keyboard.press(' ')
  await compose(['yin', 'yinyong'], '引用')
  await expect(editor.locator('blockquote')).toHaveText('引用')
})

test('the block handle adds blocks and its menu moves and converts them', async ({ page, request }) => {
  const id = await createDoc(request, '块菜单测试', '第一段\n\n第二段\n\n第三段')
  await openEditor(page, id)
  const paras = page.locator('.ProseMirror > p')
  await paras.nth(1).hover()
  const handle = page.locator('.yy-block-handle')
  await expect(handle).toBeVisible()
  await handle.getByRole('button', { name: /拖动调整位置/ }).click()
  await page.getByRole('menuitem', { name: '上移' }).click()
  await expect(paras.first()).toHaveText('第二段')

  await paras.nth(2).hover()
  await handle.getByRole('button', { name: /拖动调整位置/ }).click()
  await page.getByRole('menuitem', { name: '转换为' }).click()
  await page.getByRole('menuitem', { name: '标题 2' }).click()
  await expect(page.locator('.ProseMirror h2')).toHaveText('第三段')

  // "+" opens the slash menu on a new line below the block.
  await paras.first().hover()
  await handle.getByRole('button', { name: '在下方插入' }).click()
  await expect(page.locator('.yy-slash')).toBeVisible()
})

test('images resize from the toolbar and by dragging, and upload with progress and retry', async ({ page, request }) => {
  await page.goto('./')
  const src = await uploadImage(page, request)
  const id = await createDoc(request, '图片测试', '图片：![[e2e.png]]', { 'e2e.png': src })
  await openEditor(page, id)
  const img = page.locator('.ProseMirror .yy-image img').first()
  await img.click()
  const tools = page.locator('.yy-image-toolbar')
  await expect(tools).toBeVisible()
  await tools.locator('.yy-bubble-select').click()
  await tools.locator('.yy-bubble-list button', { hasText: '50%' }).click()
  const half = Number(await img.getAttribute('width'))
  expect(half).toBeGreaterThan(300)

  const corner = page.locator('.yy-image-handle.right')
  const box = (await corner.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 6 })
  await expect(page.locator('.yy-image-size')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.yy-image-size')).toHaveCount(0)
  const width = Number(await img.getAttribute('width'))
  expect(Math.abs(width - (half - 120 - box.width / 2))).toBeLessThanOrEqual(2)

  // The first upload fails; the placeholder offers a retry.
  let fail = true
  await page.route('**/api/assets', (route) => (fail ? ((fail = false), route.abort()) : route.continue()))
  await caretAtEnd(page.locator('.ProseMirror p').first())
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.yy-toolbar .yy-toolbar-select', { hasText: '插入' }).click()
  await page.getByRole('menuitem', { name: '图片' }).click()
  await (await chooser).setFiles({ name: 'second.png', mimeType: 'image/png', buffer: await pngBytes(page, 200, 120) })
  const placeholder = page.locator('.yy-upload')
  await expect(placeholder).toHaveClass(/failed/)
  await expect(placeholder).toContainText('上传失败')
  await placeholder.getByRole('button', { name: '重试' }).click()
  await expect(placeholder).toHaveCount(0)
  await expect(page.locator('.ProseMirror .yy-image img')).toHaveCount(2)

  // Obsidian's width syntax for Markdown images: ![alt|width](path).
  const md = await finishAndExport(page, '图片测试')
  expect(md).toContain(`![|${width}](attachments/`)
})

test('code blocks: language search, Tab indentation, line numbers', async ({ page, request }) => {
  const id = await createDoc(request, '代码测试', '```js\nconst a = 1\nconsole.log(a)\n```')
  await openEditor(page, id)
  const trigger = page.locator('.yy-lang-trigger')
  await expect(trigger).toHaveText('JavaScript')
  await trigger.click()
  await page.keyboard.type('py')
  await expect(page.locator('.yy-lang-list button').first()).toContainText('Python')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveText('Python')

  const code = page.locator('.ProseMirror pre code')
  await code.click()
  await caretAtEnd(code)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('x')
  await expect(code).toHaveText('const a = 1\nconsole.log(a)\n    x')
  await page.keyboard.press('Shift+Tab')
  await expect(code).toHaveText('const a = 1\nconsole.log(a)\nx')

  await page.locator('.yy-toolbar').getByRole('button', { name: '更多' }).click()
  await page.getByRole('menuitem', { name: '代码行号' }).click()
  await expect(page.locator('.yy-code-lines > div')).toHaveCount(3)

  const md = await finishAndExport(page, '代码测试')
  expect(md).toContain('```python\nconst a = 1\nconsole.log(a)\nx\n```')
})

test('callouts: the type panel, the fold setting and the default title', async ({ page, request }) => {
  const id = await createDoc(request, '提示块测试', '> [!note]\n> 内容')
  await openEditor(page, id)
  const title = page.locator('.ProseMirror .callout-title')
  const placeholder = () => title.evaluate((el) => getComputedStyle(el, '::before').content)
  expect(await placeholder()).toBe('"Note"')
  await page.locator('.ProseMirror .callout').hover()
  await page.locator('.yy-callout-trigger').click()
  await page.locator('.yy-callout-menu .yy-callout-type', { hasText: '技巧' }).click()
  await expect(page.locator('.ProseMirror .callout')).toHaveAttribute('data-callout', 'tip')
  expect(await placeholder()).toBe('"Tip"')
  await page.locator('.yy-callout-trigger').click()
  await page.getByRole('menuitemradio', { name: '可折叠，默认折叠' }).click()

  const md = await finishAndExport(page, '提示块测试')
  expect(md).toContain('> [!tip]-')
  await expect(page.locator('.yy-content .callout.is-collapsed')).toHaveCount(1)
})

test('Mermaid previews beside its source and keeps the last diagram on errors', async ({ page, request }) => {
  const id = await createDoc(request, '图表测试', '```mermaid\nflowchart LR\n  A --> B\n```')
  await openEditor(page, id)
  const block = page.locator('.yy-codeblock.is-mermaid')
  await expect(block.locator('.yy-mermaid-svg svg')).toBeVisible()
  await block.locator('pre code').click()
  await caretAtEnd(block.locator('pre code'))
  await page.keyboard.type('\n  B --> {{{')
  await expect(block.locator('.yy-mermaid-error')).toBeVisible()
  await expect(block.locator('.yy-mermaid-svg.stale svg')).toBeVisible()
})

test('reading pages: image viewer, folded long code and line numbers', async ({ page }) => {
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '产品手册（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '长文档示例' }).click()
  // Images load lazily and take no space until they come into view.
  const first = page.locator('.yy-content img').first()
  await first.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await first.click()
  const viewer = page.locator('.yy-lightbox')
  await expect(viewer.locator('.yy-lightbox-count')).toHaveText('1 / 2')
  await page.keyboard.press('ArrowRight')
  await expect(viewer.locator('.yy-lightbox-count')).toHaveText('2 / 2')
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)

  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '算法笔记（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '长代码' }).click()
  const pre = page.locator('.yy-content pre')
  await expect(pre).toHaveClass(/is-folded/)
  const fold = page.locator('.yy-code-fold')
  await expect(fold).toHaveText('展开全部 62 行')
  await fold.click()
  await expect(pre).not.toHaveClass(/is-folded/)
  await expect(fold).toHaveText('收起代码')

  await page.getByRole('button', { name: /^外观/ }).click()
  await page.getByRole('menuitem', { name: '代码行号' }).click()
  await expect(page.locator('html')).toHaveClass(/yy-code-numbers/)
  const number = await pre.locator('.yy-line').nth(9).evaluate((el) => getComputedStyle(el, '::before').content)
  expect(number).toBe('counter(yy-line)')
})

test('images keep their space before they load', async ({ page }) => {
  // Hold every image back; the application's own scripts under /static/assets/ still load.
  await page.route(/\/yuyan\/assets\/[0-9a-f]{32}\./, () => {})
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '产品手册（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '长文档示例' }).click()
  const heights = (locator: ReturnType<Page['locator']>) => locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  await expect(page.locator('.yy-content img')).toHaveCount(2)
  expect(Math.min(...(await heights(page.locator('.yy-content img'))))).toBeGreaterThan(20)

  await page.getByRole('link', { name: '编辑' }).click()
  await expect(page.locator('.ProseMirror .yy-image img')).toHaveCount(2)
  expect(Math.min(...(await heights(page.locator('.ProseMirror .yy-image img'))))).toBeGreaterThan(20)
})

test('versions compare with the previous and the current version, line by line', async ({ page, request }) => {
  const filler = Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 段没有变化的内容。`).join('\n\n')
  const first = `${filler}\n\n我们需要在周一之前完成这个任务。\n\n1. 下载\n2. 安装\n3. 运行\n\n结尾。\n`
  const second = first.replace('周一', '周五').replace('2. 安装\n3. 运行', '2. 运行').replace('结尾。', '新增的一段。\n\n结尾。')
  const id = await createDoc(request, '对比测试', first)
  const save = async (title: string, md: string) => {
    const { revision } = (await (await request.get(`api/docs/${id}`)).json()) as { revision: number }
    const content = markdownToDoc(md, { resolveLink: () => null, resolveImage: () => null })
    expect((await request.put(`api/docs/${id}`, { data: { title, content, baseRevision: revision } })).ok()).toBeTruthy()
  }
  await request.post(`api/docs/${id}/snapshot`)
  await save('对比测试（二）', second)
  await request.post(`api/docs/${id}/snapshot`)
  await save('对比测试（二）', second.replace('新增的一段', '新增并修改的一段'))

  await page.goto(`docs/${id}/history`)
  await expect(page.locator('.yy-version-list li')).toHaveCount(3)
  await expect(page.locator('.yy-version-list li').last().getByRole('link', { name: '对比', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '对比', exact: true }).first().click()
  await expect(page).toHaveURL(/compare=previous/)
  const diff = page.locator('.yy-diff')
  const lines = (kind: string) => diff.locator(`.yy-diff-line.${kind} .yy-diff-text`).filter({ hasText: /\S/ })
  await expect(page.locator('.yy-diff-title ins')).toHaveText('（二）')
  await expect(page.locator('.yy-diff-summary')).toContainText('新增 3 行')
  await expect(page.locator('.yy-diff-summary')).toContainText('删除 3 行')
  await expect(lines('removed')).toHaveText(['我们需要在周一之前完成这个任务。', '2. 安装', '3. 运行'])
  await expect(lines('added')).toHaveText(['我们需要在周五之前完成这个任务。', '2. 运行', '新增的一段。'])
  await expect(diff.locator('del')).toHaveText(['一', '3'])
  await expect(diff.locator('ins')).toHaveText(['五', '2'])
  await expect(diff).not.toContainText('第 1 段没有变化的内容。')
  await diff.locator('.yy-diff-gap').first().click()
  await expect(diff).toContainText('第 1 段没有变化的内容。')

  await page.getByRole('link', { name: '与当前版本对比' }).click()
  await expect(page).toHaveURL(/compare=current/)
  await expect(lines('removed')).toHaveText(['新增的一段。'])
  await expect(lines('added')).toHaveText(['新增并修改的一段。'])
  await expect(diff.locator('ins')).toHaveText(['并修改'])
  await expect(page.locator('.yy-diff-title')).toHaveCount(0)

  await page.getByRole('link', { name: '预览', exact: true }).click()
  await expect(page.locator('.yy-content')).toContainText('新增的一段。')
  await expect(diff).toHaveCount(0)
})

test('search results open at the first match, unfolding long code, code blocks and callouts', async ({ page }) => {
  await page.goto('search?q=heappush')
  await page.locator('.yy-result-title', { hasText: '长代码' }).click()
  await expect(page).toHaveURL(/[?&]hl=heappush/)
  await expect.poll(async () => (await searchHighlights(page)).map((h) => h.text)).toEqual(['heappush'])
  await expect(page.locator('.yy-content pre')).not.toHaveClass(/is-folded/)
  const [hit] = await searchHighlights(page)
  expect(hit.top).toBeGreaterThan(52)
  expect(hit.bottom).toBeLessThan(860)

  await page.goto('search?q=int dijkstra')
  await page.locator('.yy-result-title', { hasText: '最短路' }).click()
  await expect.poll(async () => (await searchHighlights(page)).map((h) => h.text)).toEqual(['int dijkstra'])
  await expect(page.locator('.yy-content .code-block')).not.toHaveClass(/is-collapsed/)

  await page.goto('search?q=自动重试')
  await page.locator('.yy-result-title', { hasText: '常见问题' }).click()
  await expect.poll(async () => (await searchHighlights(page)).map((h) => h.text)).toEqual(['自动重试'])
  await expect(page.locator('.yy-content .callout[data-callout="failure"]')).not.toHaveClass(/is-collapsed/)
})

async function openLongDocument(page: Page) {
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '产品手册（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '长文档示例' }).click()
  await expect(page.locator('.yy-doc-title')).toHaveText('长文档示例')
}

test('the outline sits at the right edge; unpinned, it is a line per heading that opens on hover', async ({ page }) => {
  await openLongDocument(page)
  const aside = page.locator('.yy-doc-aside')
  const article = page.locator('.yy-article')
  const links = aside.getByRole('link')
  const lines = aside.locator('.yy-toc-lines')
  const away = () => page.mouse.move(300, 500)
  await expect(links.first()).toBeVisible()
  const headings = await links.count()
  const box = (await aside.boundingBox())!
  expect(1360 - (box.x + box.width)).toBeLessThan(40)
  const left = (await article.boundingBox())!.x
  await expect(page.locator('#yy-topbar-actions').getByRole('button', { name: '大纲' })).toHaveCount(0)

  // Under the pointer, the outline stays where it is when the eye unpins or pins it.
  const at = async () => {
    const b = (await links.first().boundingBox())!
    return [Math.round(b.x), Math.round(b.y)]
  }
  const pinned = await at()
  await aside.getByRole('button', { name: '隐藏大纲' }).click()
  expect(await at()).toEqual(pinned)
  await away()
  await expect(links.first()).toBeHidden()
  await expect(lines.locator('span')).toHaveCount(headings)
  const widths = await lines.locator('span').evaluateAll((spans) => spans.map((s) => parseFloat(getComputedStyle(s, '::before').width)))
  expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths))
  expect((await article.boundingBox())!.x).toBe(left)
  // The outline opens over the lines, which Playwright's hover would take as covering them.
  await lines.hover({ force: true })
  await expect(links.first()).toBeVisible()
  await away()
  await expect(links.first()).toBeHidden()

  await page.reload()
  await expect(links.first()).toBeHidden()
  await lines.hover({ force: true })
  const opened = await at()
  await aside.getByRole('button', { name: '固定显示大纲' }).click()
  expect(await at()).toEqual(opened)
  await away()
  await expect(links.first()).toBeVisible()
  await expect(lines).toHaveCount(0)
  expect((await article.boundingBox())!.x).toBe(left)
})

test('the outline highlights the entry clicked and then the section being read', async ({ page, request }) => {
  await openLongDocument(page)
  const aside = page.locator('.yy-doc-aside')
  const active = aside.locator('a.active')
  const still = () =>
    expect
      .poll(async () => {
        const y = await page.evaluate(() => scrollY)
        await page.waitForTimeout(200)
        return y === (await page.evaluate(() => scrollY))
      })
      .toBe(true)
  // Jumps keep the entry clicked, although the smooth scroll passes other headings.
  for (const name of ['1.1 细节', '4.2 小结', '2. 目标']) {
    await aside.getByRole('link', { name, exact: true }).click()
    await still()
    await expect(active).toHaveText(name)
  }
  // Scrolling by hand, the section is the one whose heading last passed the top of the page; at
  // the end of the page, the last heading.
  const last = (await aside.getByRole('link').allTextContents()).at(-1)!
  const put = (text: string, top: number) =>
    page.evaluate(
      ([t, y]) => {
        const h = [...document.querySelectorAll('.yy-content :is(h1, h2, h3)')].find((e) => e.textContent?.includes(t))!
        window.scrollBy(0, h.getBoundingClientRect().top - y)
      },
      [text, top] as const,
    )
  await put('5. 验证', 60)
  await expect(active).toHaveText('5. 验证')
  await put('5. 验证', 200)
  await expect(active).toHaveText('4.2 小结')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(active).toHaveText(last)

  // Near the end the page stops before the heading clicked reaches the top; the entry stays until
  // the reader scrolls again.
  const body = Array.from({ length: 6 }, (_, i) => `## 第 ${i + 1} 节\n\n${'正文。'.repeat(200)}`)
  const id = await createDoc(request, '大纲末尾测试', [...body, '## 倒数第二节\n\n短。', '## 最后一节\n\n短。'].join('\n\n'))
  await page.goto(`docs/${id}`)
  await aside.getByRole('link', { name: '倒数第二节', exact: true }).click()
  await still()
  await expect(active).toHaveText('倒数第二节')
  await page.evaluate(() => window.scrollBy(0, -300))
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(active).toHaveText('最后一节')
})

test('sections fold under their headings, stay folded, and open for the outline and search', async ({ page }) => {
  await openLongDocument(page)
  const background = page.locator('.yy-content > h2', { hasText: '1. 背景' })
  const detail = page.locator('.yy-content > h3', { hasText: '1.2 小结' })
  await background.hover()
  await background.getByRole('button', { name: '折叠这一节' }).click()
  await expect(detail).toBeHidden()
  await expect(page.locator('.yy-content > h2', { hasText: '2. 目标' })).toBeVisible()
  await page.reload()
  await expect(detail).toBeHidden()
  await page.locator('.yy-doc-aside a', { hasText: '1.2 小结' }).click()
  await expect(detail).toBeInViewport()

  await background.getByRole('button', { name: '折叠这一节' }).click()
  await expect(detail).toBeHidden()
  await page.goto('search?q=第 1 节')
  await page.locator('.yy-result-title', { hasText: '长文档示例' }).click()
  await expect.poll(async () => (await searchHighlights(page)).length).toBeGreaterThan(0)
  await expect(detail).toBeVisible()
  await expect(background.getByRole('button', { name: '折叠这一节' })).toBeVisible()
})

test('code blocks look like Yuque: One Dark, with a title bar that collapses them', async ({ page, request }) => {
  const id = await createDoc(request, '代码标题测试', '```cpp title="Dijkstra" collapsed\nint dijkstra();\n```\n\n边权非负时使用。\n\n```cpp\nint main();\n```')
  await page.goto(`docs/${id}`)
  const colours = (block: ReturnType<Page['locator']>, token: string) =>
    block.evaluate((b, t) => ({ code: getComputedStyle(b.querySelector('pre')!).backgroundColor, type: getComputedStyle(b.querySelector(t)!).color }), token)
  const oneDark = { code: 'rgb(40, 44, 52)', type: 'rgb(86, 182, 194)' }
  const block = page.locator('.yy-content .code-block').first()
  const title = block.locator('.code-title')
  await expect(title).toContainText('Dijkstra')
  await expect(title.locator('.code-lang')).toHaveText('C++')
  await expect(block.locator('pre')).toBeHidden()
  await title.click()
  await expect(block.locator('pre')).toBeVisible()
  expect(await colours(block, '.chroma .kt')).toEqual(oneDark)
  await title.getByRole('button', { name: '复制' }).click()
  await expect(block.locator('pre')).toBeVisible()

  // The tab at the top of the code, just below the title bar, shows or hides the bar for this
  // visit only.
  const bar = (await title.boundingBox())!
  const tab = (await block.locator('.code-tab').boundingBox())!
  expect(Math.abs(tab.y - (bar.y + bar.height))).toBeLessThan(1.5)
  const plain = page.locator('.yy-content .code-block').nth(1)
  await expect(plain.locator('.code-title')).toBeHidden()
  await plain.getByRole('button', { name: '显示标题栏' }).click()
  await expect(plain.locator('.code-title .code-lang')).toHaveText('C++')
  await plain.locator('.code-title').click()
  await expect(plain.locator('pre')).toBeHidden()
  await block.getByRole('button', { name: '隐藏标题栏' }).click()
  await expect(title).toBeHidden()
  await expect(block.locator('pre > .yy-copy')).toBeVisible()
  await page.reload()
  await expect(title).toBeVisible()
  await expect(plain.locator('.code-title')).toBeHidden()

  // The editor keeps the block collapsed; the arrow opens it, and so does finding text inside it.
  await page.getByRole('link', { name: '编辑' }).click()
  const code = page.locator('.ProseMirror .yy-codeblock').first()
  await expect(code.locator('.yy-codeblock-name')).toHaveValue('Dijkstra')
  await expect(code.locator('pre')).toBeHidden()
  await code.getByRole('button', { name: '展开代码' }).click()
  await expect(code.locator('pre')).toBeVisible()
  expect(await colours(code, '.hljs-type')).toEqual(oneDark)
  await code.getByRole('button', { name: '收起代码' }).click()
  await expect(code.locator('pre')).toBeHidden()
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.keyboard.type('dijkstra')
  await expect(code.locator('pre')).toBeVisible()
  await expect(page.locator('.ProseMirror .yy-find-match.current')).toBeInViewport()
})

test('code block titles are added, renamed and removed in the editor and kept in Markdown', async ({ page, request }) => {
  const id = await createDoc(request, '代码标题编辑', '```cpp title="家谱树" collapsed\nint main() {}\n```\n\n```js\nlet a\n```')
  await openEditor(page, id)
  const titled = page.locator('.ProseMirror .yy-codeblock').first()
  const plain = page.locator('.ProseMirror .yy-codeblock').nth(1)
  await plain.getByRole('button', { name: '显示标题栏' }).click()
  await expect(plain.locator('.yy-codeblock-name')).toBeFocused()
  await page.keyboard.type('示例')
  // Enter goes back to the start of the code, a frame later.
  await page.keyboard.press('Enter')
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await page.keyboard.type('x')
  await expect(plain.locator('pre code')).toHaveText('xlet a')
  // The tab sits on the code, so a collapsed block is opened first.
  await titled.getByRole('button', { name: '展开代码' }).click()
  await titled.getByRole('button', { name: '隐藏标题栏' }).click()
  await expect(titled.locator('.yy-codeblock-title')).toHaveCount(0)
  await expect(titled.locator('pre')).toBeVisible()

  const md = await finishAndExport(page, '代码标题编辑')
  expect(md).toContain('```cpp\nint main() {}\n```')
  expect(md).toContain('```javascript title="示例"\nxlet a\n```')
  await expect(page.locator('.yy-content .code-title', { hasText: '示例' })).toBeVisible()
})

test('images still loading are cancelled when the page is left', async ({ page }) => {
  const held: string[] = []
  const aborted: string[] = []
  await page.route(/\/yuyan\/assets\/[0-9a-f]{32}\./, (route) => void held.push(route.request().url()))
  page.on('requestfailed', (r) => {
    if (/\/assets\//.test(r.url())) aborted.push(r.url())
  })
  await openLongDocument(page)
  await page.locator('.yy-content img').first().scrollIntoViewIfNeeded()
  await expect.poll(() => held.length).toBeGreaterThan(0)
  await page.locator('.yy-pager a').first().click()
  await expect.poll(() => aborted.length).toBe(held.length)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 412, height: 520 }, hasTouch: true, isMobile: true })

  test('the outline drawer scrolls, and code scrolls under a fixed copy button', async ({ page }) => {
    await openLongDocument(page)
    await page.getByRole('button', { name: '大纲', exact: true }).tap()
    const aside = page.locator('.yy-doc-aside')
    await expect(aside).toBeVisible()
    const drawer = await aside.evaluate((a) => {
      a.scrollTop = 100
      return { top: a.scrollTop, height: a.clientHeight }
    })
    expect(drawer.top).toBe(100)
    expect(drawer.height).toBeLessThanOrEqual(520 - 52)

    await page.goto('search?q=heappush')
    await page.locator('.yy-result-title', { hasText: '长代码' }).click()
    const pre = page.locator('.yy-content pre').first()
    const copy = pre.locator('.yy-copy')
    const before = await copy.boundingBox()
    expect(await pre.locator('code').evaluate((c) => ((c.scrollLeft = 200), c.scrollLeft))).toBe(200)
    expect(await copy.boundingBox()).toEqual(before)
  })
})

test('a menu that has to scroll shows half of its last item', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 210 })
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '产品手册（示例）' }).click()
  await page.getByRole('button', { name: '切换知识库' }).click()
  const menu = page.locator('.yy-menu')
  await expect(menu.getByRole('menuitem').first()).toBeVisible()
  const shown = () =>
    menu.evaluate((m) => {
      const items = [...m.children].filter((c): c is HTMLElement => c.getAttribute('role') === 'menuitem')
      const cut = items.find((i) => i.offsetTop + i.offsetHeight > m.clientHeight)
      return cut ? (m.clientHeight - cut.offsetTop) / cut.offsetHeight : 1
    })
  await expect.poll(shown).toBeCloseTo(0.5, 1)
})

test('highlighted code stays legible in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '算法笔记（示例）' }).click()
  await page.locator('.yy-sidebar .yy-tree-row', { hasText: '基础' }).click()
  await page.locator('.yy-sidebar .yy-tree-row', { hasText: '排序' }).click()
  const punctuation = page.locator('.yy-content pre .p', { hasText: '(' }).first()
  const [r, g, b] = (await punctuation.evaluate((el) => getComputedStyle(el).color)).match(/\d+/g)!.map(Number)
  expect((r + g + b) / 3).toBeGreaterThan(128)
})

test('the longest documents stay responsive while editing', async ({ page, request }) => {
  test.setTimeout(120_000)
  // About as many blocks as the largest real document (3,800), in a similar mix.
  const parts: string[] = []
  for (let i = 0; parts.length < 3800; i++) {
    parts.push(`## 第 ${i + 1} 节`, `正文段落 ${i + 1}，包含**加粗**、\`代码\`和一个公式 $x_${i}$。`, `- 列表项 ${i + 1}\n- 另一项`, `> 引用 ${i + 1}`)
    if (i % 5 === 0) parts.push('```js\nconst a = 1\nconsole.log(a)\n```')
    if (i % 25 === 0) parts.push('| 列 1 | 列 2 |\n| --- | --- |\n| a | b |')
  }
  const id = await createDoc(request, '长文档性能', parts.join('\n\n'))
  const opened = Date.now()
  await openEditor(page, id)
  const openMs = Date.now() - opened
  const times = await page.evaluate(async () => {
    const view = document.querySelector<HTMLElement & { editor: { commands: { insertContent: (s: string) => void; focus: (p: string) => void } } }>('.ProseMirror')!
    const ed = view.editor
    ed.commands.focus('end')
    const out: number[] = []
    for (let i = 0; i < 40; i++) {
      const t = performance.now()
      ed.commands.insertContent('字')
      out.push(performance.now() - t)
      await new Promise((r) => requestAnimationFrame(r))
    }
    return out.sort((a, b) => a - b)
  })
  const median = times[Math.floor(times.length / 2)]
  const p90 = times[Math.floor(times.length * 0.9)]
  console.log(`long document: ${parts.length} blocks, opened in ${openMs} ms, keystroke median ${median.toFixed(1)} ms, p90 ${p90.toFixed(1)} ms`)
  expect(median).toBeLessThan(50)
  expect(p90).toBeLessThan(100)

  const typed = Date.now()
  await page.keyboard.type('连续输入的二十个字连续输入的二十个字')
  const typeMs = Date.now() - typed
  console.log(`long document: typed 18 characters through the keyboard in ${typeMs} ms`)
  expect(typeMs).toBeLessThan(3000)
})

test('buttons share one tooltip, shown soon after the pointer rests', async ({ page }) => {
  await openLongDocument(page)
  const tip = page.locator('.yy-tooltip')
  await page.locator('#yy-topbar-actions').getByRole('button', { name: '更多操作' }).hover()
  await expect(tip).toHaveText('更多操作', { timeout: 800 })
  await page.locator('.yy-book-head').getByRole('button', { name: '新建文档' }).hover()
  await expect(tip).toHaveText('新建文档', { timeout: 300 })
  await page.mouse.move(700, 600)
  await expect(tip).toHaveCount(0)
})

test('outline entries fold one by one or all at once, and so does the tree', async ({ page }) => {
  await openLongDocument(page)
  const aside = page.locator('.yy-doc-aside')
  const links = aside.getByRole('link')
  const all = await links.count()
  await aside.locator('li', { hasText: '1. 背景' }).getByRole('button', { name: '折叠' }).click()
  await expect(aside.getByRole('link', { name: '1.1 细节', exact: true })).toHaveCount(0)
  await expect(links).toHaveCount(all - 2)
  await aside.getByRole('button', { name: '全部折叠' }).click()
  await expect(links).toHaveCount(1)
  await aside.getByRole('button', { name: '全部展开' }).click()
  await expect(links).toHaveCount(all)

  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '算法笔记（示例）' }).click()
  const head = page.locator('.yy-tree-head')
  const rows = page.locator('.yy-sidebar .yy-tree-row')
  await head.getByRole('button', { name: '全部折叠' }).click()
  const folded = await rows.count()
  await head.getByRole('button', { name: '全部展开' }).click()
  await expect.poll(() => rows.count()).toBeGreaterThan(folded)
  await head.getByRole('button', { name: '全部折叠' }).click()
  await expect(rows).toHaveCount(folded)
})

test('the editor: the outline as on reading pages, Mod-A within a block, heading levels at the handle', async ({ page, request }) => {
  const id = await createDoc(request, '编辑器细节', '## 第一节\n\n开头段落。\n\n```js\nconst a = 1\nconst b = 2\n```\n\n### 小节\n\n结尾。')
  await openEditor(page, id)
  await expect(page.locator('.yy-toolbar').getByRole('button', { name: '大纲', exact: true })).toHaveCount(0)
  const aside = page.locator('.yy-editor-outline')
  await expect(aside.getByRole('link')).toHaveCount(2)
  await aside.getByRole('button', { name: '隐藏大纲' }).click()
  await page.mouse.move(400, 500)
  await expect(aside.locator('.yy-toc-lines span')).toHaveCount(2)
  await expect(aside.getByRole('link')).toHaveCount(0)
  await aside.locator('.yy-toc-lines').hover({ force: true })
  await aside.getByRole('button', { name: '固定显示大纲' }).click()
  await page.mouse.move(400, 500)
  await expect(aside.getByRole('link')).toHaveCount(2)

  // Mod-A selects the code first, then the whole document.
  await place(page.locator('.ProseMirror pre code'))
  await page.keyboard.press('ControlOrMeta+a')
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('const a = 1\nconst b = 2')
  await page.keyboard.press('ControlOrMeta+a')
  await expect.poll(() => page.evaluate(() => getSelection()?.toString() ?? '')).toContain('开头段落')

  // The handle beside a heading shows its level.
  await page.locator('.ProseMirror h3').hover()
  await expect(page.locator('.yy-handle-level')).toHaveText('H3')
})

test('pressing E once gives a hint, twice opens the editor', async ({ page, request }) => {
  const id = await createDoc(request, '快捷键测试', '内容。')
  await page.goto(`docs/${id}`)
  await expect(page.locator('.yy-content')).toContainText('内容。')
  await page.keyboard.press('e')
  await expect(page.locator('.yy-toast', { hasText: '连按两次 E 键进入编辑模式' })).toBeVisible()
  await page.keyboard.press('e')
  await page.keyboard.press('e')
  await expect(page).toHaveURL(new RegExp(`docs/${id}/edit$`))
})

for (const narrow of [false, true]) {
  test(`entering the editor keeps the reading position (${narrow ? 'narrow, E twice' : 'desktop, edit link'})`, async ({ page, request }) => {
    if (narrow) await page.setViewportSize({ width: 375, height: 667 })
    const paragraph = '这是正在阅读的长段落，切换到编辑后应该继续看到这里。'.repeat(60)
    const padding = Array.from({ length: 20 }, (_, i) => `第 ${i} 段前置内容。`.repeat(10))
    const id = await createDoc(request, '阅读位置测试', [
      '## 前面折叠', ...padding,
      '## 代码示例', `\`\`\`js\n${'console.log("long code")\n'.repeat(80)}\`\`\``,
      '| 列一 | 列二 |\n| --- | --- |\n| 单元格 | 单元格 |',
      '## 阅读位置', paragraph, ...padding,
    ].join('\n\n'))
    await page.goto(`docs/${id}`)
    const heading = page.locator('.yy-content > h2', { hasText: '前面折叠' })
    await heading.getByRole('button', { name: '折叠这一节' }).click({ force: true })
    // Auto-fold controls are extra DOM siblings, and hidden sections still count as document
    // nodes. Both must be handled when finding the matching editor block.
    await expect(page.locator('.yy-code-fold')).toHaveCount(1)
    const reading = page.locator('.yy-content > p', { hasText: '这是正在阅读的长段落' })
    await reading.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top + 180))
    const readingOffset = await reading.evaluate((el) => document.querySelector('.yy-topbar')!.getBoundingClientRect().bottom + 16 - el.getBoundingClientRect().top)
    // Loading the editor's document is asynchronous; the scroll must wait for its content.
    await page.route(`**/api/docs/${id}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      await route.continue()
    })
    if (narrow) {
      await page.keyboard.press('e')
      await page.keyboard.press('e')
    } else {
      await page.getByRole('link', { name: '编辑', exact: true }).click()
    }
    const editing = page.locator('.ProseMirror > p', { hasText: '这是正在阅读的长段落' })
    await expect(editing).toBeVisible()
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(true)
    await expect.poll(() => editing.evaluate((el) => document.querySelector('.yy-toolbar')!.getBoundingClientRect().bottom + 16 - el.getBoundingClientRect().top)).toBeCloseTo(readingOffset, 0)
    expect(await page.locator('.ProseMirror').evaluate((el) => (el as HTMLElement & { editor: { state: { selection: { $from: { parent: { textContent: string } } } } } }).editor.state.selection.$from.parent.textContent)).toBe(paragraph)
    const scroll = await page.evaluate(() => scrollY)
    await page.keyboard.type('x')
    await expect(editing).toContainText('x')
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page.locator('.yy-doc-title')).toBeVisible()

    // A fresh edit URL and entering from the top have no reading anchor to restore.
    await openEditor(page, id)
    expect(await page.evaluate(() => scrollY)).toBe(0)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page.locator('.yy-doc-title')).toBeVisible()
    await page.getByRole('link', { name: '编辑', exact: true }).click()
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(true)
    expect(await page.evaluate(() => scrollY)).toBe(0)
  })
}

test('cancelling the editor drops the edits of this session and leaves no version', async ({ page, request }) => {
  const id = await createDoc(request, '取消测试', '原来的内容。')
  const versions = async () => ((await (await request.get(`api/docs/${id}/versions`)).json()) as { versions: unknown[] }).versions.length
  const before = await versions()
  // Nothing edited: 取消 just leaves.
  await openEditor(page, id)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`docs/${id}$`))

  await openEditor(page, id)
  await caretAtEnd(page.locator('.ProseMirror p').first())
  await page.keyboard.type('又写了一句。')
  await expect.poll(async () => JSON.stringify(((await (await request.get(`api/docs/${id}`)).json()) as { content: unknown }).content)).toContain('又写了一句')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改' }).click()
  await expect(page).toHaveURL(new RegExp(`docs/${id}$`))
  await expect(page.locator('.yy-content')).toContainText('原来的内容。')
  await expect(page.locator('.yy-content')).not.toContainText('又写了一句')
  expect(await versions()).toBe(before)
})

test('table columns and rows drag to size, and wide tables scroll into the left margin', async ({ page, request }) => {
  const id = await createDoc(request, '表格尺寸', '| 名称 | 说明 |\n| --- | --- |\n| a | b |\n| c | d |')
  await openEditor(page, id)
  type Cell = { attrs: { colwidth: number[] | null } }
  const table = () => page.evaluate(() => (document.querySelector('.ProseMirror') as unknown as { editor: { getJSON: () => { content: unknown[] } } }).editor.getJSON().content[0]) as Promise<{ content: { attrs?: { height?: number }; content: Cell[] }[] }>
  const header = (await page.locator('.ProseMirror th').first().boundingBox())!
  await page.mouse.move(header.x + header.width - 2, header.y + header.height / 2)
  await expect(page.locator('.ProseMirror .column-resize-handle').first()).toBeAttached()
  await page.mouse.down()
  await page.mouse.move(header.x + header.width + 150, header.y + header.height / 2, { steps: 5 })
  await page.mouse.up()
  // Every column gets a width; the one dragged grows by the distance moved.
  await expect
    .poll(async () => (await table()).content.flatMap((r) => r.content.map((c) => c.attrs.colwidth?.[0] ?? 0)).every(Boolean))
    .toBe(true)
  const first = (await table()).content[0].content[0].attrs.colwidth![0]
  expect(Math.abs(first - (header.width + 152))).toBeLessThan(3)

  const row = (await page.locator('.ProseMirror tr').nth(1).boundingBox())!
  await page.mouse.move(row.x + 20, row.y + row.height - 1)
  await expect(page.locator('.yy-row-resize-line')).toBeVisible()
  await page.mouse.down()
  await page.mouse.move(row.x + 20, row.y + row.height + 40, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await table()).content[1].attrs?.height ?? 0).toBeGreaterThan(row.height + 30)

  // Markdown cannot hold the sizes, so the export writes the table as HTML.
  const md = await finishAndExport(page, '表格尺寸')
  expect(md).toMatch(/<table style="width: \d+px">/)
  expect(md).toMatch(/<tr style="height: \d+px">/)
  const shown = page.locator('.yy-content table')
  await expect(shown).toHaveAttribute('style', /^width: \d+px/)
  await expect(shown.locator('tr').nth(1)).toHaveAttribute('style', /height: \d+px/)

  // Columns wider than the page scroll sideways; the scroll area reaches left to the page edge.
  const wide = (await (await request.post('api/docs', { data: { bookId: (await (await request.get(`api/docs/${id}`)).json()).bookId, parentId: null, kind: 'doc', title: '宽表格' } })).json()) as { id: number }
  const cell = (type: string, i: number) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: [480], align: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `列 ${i}` }] }] })
  const content = {
    type: 'doc',
    content: [
      { type: 'table', content: [{ type: 'tableRow', content: [0, 1, 2].map((i) => cell('tableHeader', i)) }, { type: 'tableRow', content: [0, 1, 2].map((i) => cell('tableCell', i)) }] },
      { type: 'paragraph' },
    ],
  }
  expect((await request.put(`api/docs/${wide.id}`, { data: { title: '宽表格', content, baseRevision: 1 } })).ok()).toBeTruthy()
  await page.goto(`docs/${wide.id}`)
  const frame = page.locator('.yy-table-frame')
  const main = (await page.locator('main').boundingBox())!
  const text = (await page.locator('.yy-content').boundingBox())!
  await expect.poll(async () => Math.round((await frame.boundingBox())!.x - main.x)).toBe(0)
  // The table starts with the text and shows more of itself on the right; the scrollbar spans the
  // text column; shadows mark what is hidden.
  expect(Math.round((await frame.locator('table').boundingBox())!.x - text.x)).toBe(0)
  const box = (await frame.boundingBox())!
  expect(box.x + box.width).toBeGreaterThan(text.x + text.width + 50)
  await frame.hover()
  const bar = (await frame.locator('.yy-table-bar').boundingBox())!
  expect(Math.round(bar.x - text.x)).toBe(0)
  expect(Math.round(bar.width - text.width)).toBe(0)
  await expect(frame).toHaveClass(/has-right/)
  await expect(frame).not.toHaveClass(/has-left/)
  const bleed = await frame.evaluate((f) => parseFloat(f.style.getPropertyValue('--bleed')))
  expect(bleed).toBeGreaterThan(0)
  await frame.locator('.yy-table-scroll').evaluate((s, x) => s.scrollTo(x, 0), bleed + 100)
  await expect(frame).toHaveClass(/has-left/)

  // The editor frames tables the same way; a column border dragged past the visible right edge
  // stays at the edge while the table scrolls left under it.
  await openEditor(page, wide.id)
  const edFrame = page.locator('.ProseMirror .yy-table-frame')
  const scroller = edFrame.locator('.yy-table-scroll')
  const edMain = (await page.locator('main').boundingBox())!
  await expect.poll(async () => Math.round((await edFrame.boundingBox())!.x - edMain.x)).toBe(0)
  const th = page.locator('.ProseMirror th').first()
  const start = (await th.boundingBox())!
  const edge = await scroller.evaluate((s) => s.getBoundingClientRect().right)
  await page.mouse.move(start.x + start.width - 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(edge + 40, start.y + start.height / 2, { steps: 12 })
  await expect.poll(() => scroller.evaluate((s) => s.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(async () => Math.abs((await th.evaluate((c) => c.getBoundingClientRect().right)) - (edge - 8))).toBeLessThan(6)
  await page.mouse.up()
})
