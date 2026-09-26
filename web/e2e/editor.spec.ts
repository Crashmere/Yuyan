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
// helpers wait until the editor has taken them before the test types.
async function selectText(page: Page, locator: ReturnType<Page['locator']>, text: string) {
  await locator.evaluate(async (el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(t)
      if (i < 0) continue
      getSelection()!.setBaseAndExtent(n, i, n, i + t.length)
      const { editor } = document.querySelector<EditorElement>('.ProseMirror')!
      for (let k = 0; k < 40; k++) {
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
    if (last) getSelection()!.setBaseAndExtent(last, last.textContent!.length, last, last.textContent!.length)
    else getSelection()!.collapse(el, 0)
    const { editor } = document.querySelector<EditorElement>('.ProseMirror')!
    for (let k = 0; k < 40; k++) {
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
  await textBubble(page).locator('[title^="粗体"]').click()
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
  await textBubble(page).locator('[title="链接"]').click()
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

test('Cmd/Ctrl+K opens the search panel: recent documents, titles, pinyin initials, full text', async ({ page, request }) => {
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
  await input.fill('Bellman')
  await expect(panel.locator('.yy-search-item', { hasText: '最短路' }).locator('.yy-search-snippet mark')).toHaveText('Bellman')
  await page.keyboard.press('Enter')
  await expect(page.locator('.yy-doc-title')).toHaveText('最短路')
  await expect(panel).toHaveCount(0)

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
