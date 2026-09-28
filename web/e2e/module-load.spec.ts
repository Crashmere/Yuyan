import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { markdownToDoc } from '../src/schema/markdown'

async function createDoc(request: APIRequestContext, source = 'flowchart LR\n  A --> B') {
  const books = await (await request.get('api/books')).json()
  const bookId = books.find((b: { name: string }) => b.name === '读书摘录（示例）').id
  const { id } = await (await request.post('api/docs', { data: { bookId, kind: 'doc', title: '图表加载样例' } })).json()
  expect((await request.put(`api/docs/${id}`, { data: {
    title: '图表加载样例', baseRevision: 1,
    content: markdownToDoc(`正文\n\n\`\`\`mermaid\n${source}\n\`\`\``),
  } })).ok()).toBe(true)
  return id as number
}

async function failChunk(page: Page, pattern: RegExp) {
  await page.route(pattern, route => route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found' }))
  return () => page.unroute(pattern)
}

for (const width of [1360, 375]) {
  test(`Mermaid core 404 preserves reading source and refresh recovers at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 860 })
    const id = await createDoc(request)
    const recover = await failChunk(page, /\/mermaid\.core-[^/]+\.js$/)
    await page.goto(`docs/${id}`)
    const notice = page.locator('.yy-module-notice')
    await expect(notice).toBeVisible()
    await expect(page.locator('.yy-mermaid-error')).toContainText('图表组件加载失败')
    await expect(page.locator('.yy-mermaid-error')).not.toContainText('语法有误')
    await expect(page.locator('.yy-content pre')).toContainText('A --> B')
    const box = await notice.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await recover()
    await notice.getByRole('button', { name: '刷新页面', exact: true }).click()
    await expect(page.locator('.yy-content .yy-mermaid svg')).toBeVisible()
    await expect(notice).toHaveCount(0)
    await expect(page.locator('.yy-mermaid-error')).toHaveCount(0)
  })
}

test('Mermaid nested diagram import fails as a load error and keeps the last preview', async ({ page, request }) => {
  const id = await createDoc(request)
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.yy-save-text')).toHaveText('已保存')
  await expect(page.locator('.yy-mermaid-svg svg')).toBeVisible()
  const recover = await failChunk(page, /\/sequenceDiagram-[^/]+\.js$/)
  await page.locator('.ProseMirror').evaluate((el: any) => {
    const editor = el.editor
    editor.state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'codeBlock') editor.view.dispatch(editor.state.tr.insertText('sequenceDiagram\n  Alice->>Bob: hello', pos + 1, pos + node.nodeSize - 1))
    })
  })
  await expect(page.locator('.yy-mermaid-error')).toContainText('图表组件加载失败')
  await expect(page.locator('.yy-mermaid-svg.stale svg')).toBeVisible()
  await recover()
  await page.getByRole('button', { name: '保存并刷新', exact: true }).click()
  await expect(page.locator('.yy-module-notice')).toHaveCount(0)
  await expect(page.locator('.yy-mermaid-svg svg')).toContainText('Alice')
})

test('refresh waits for the latest edits made during saving', async ({ page, request }) => {
  const id = await createDoc(request)
  const recover = await failChunk(page, /\/mermaid\.core-[^/]+\.js$/)
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.yy-save-text')).toHaveText('已保存')
  await expect(page.locator('.yy-module-notice')).toBeVisible()
  await expect(page.locator('.yy-mermaid-error')).toContainText('图表组件加载失败')
  await page.locator('.yy-title-input').fill('保存前修改')
  let saving = false
  let release: () => void = () => {}
  const hold = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/docs/${id}`, async route => {
    if (route.request().method() === 'PUT' && !saving) { saving = true; await hold }
    await route.continue()
  })
  await recover()
  await page.getByRole('button', { name: '保存并刷新', exact: true }).click()
  await expect.poll(() => saving).toBe(true)
  await page.locator('.yy-title-input').fill('保存中继续修改')
  await page.locator('.ProseMirror > p').first().fill('保存中修改的正文')
  release()
  await expect(page.locator('.yy-module-notice')).toHaveCount(0)
  await expect(page.locator('.yy-title-input')).toHaveValue('保存中继续修改')
  await expect(page.locator('.ProseMirror')).toContainText('保存中修改的正文')
  await expect(page.locator('.yy-mermaid-svg svg')).toBeVisible()
  const doc = await (await request.get(`api/docs/${id}`)).json()
  expect(doc.title).toBe('保存中继续修改')
  expect(JSON.stringify(doc.content)).toContain('保存中修改的正文')
})

test('a save conflict prevents refresh and preserves the local draft', async ({ page, request }) => {
  const id = await createDoc(request)
  const recover = await failChunk(page, /\/mermaid\.core-[^/]+\.js$/)
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.yy-save-text')).toHaveText('已保存')
  await expect(page.locator('.yy-module-notice')).toBeVisible()
  await page.route(`**/api/docs/${id}`, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', revision: 3 }) })
    : route.continue())
  await page.locator('.yy-title-input').fill('保留冲突草稿')
  await recover()
  await page.getByRole('button', { name: '保存并刷新', exact: true }).click()
  await expect(page.locator('.yy-module-notice')).toContainText('修改尚未保存')
  await expect(page.locator('.yy-title-input')).toHaveValue('保留冲突草稿')
  expect(await page.evaluate(id => localStorage.getItem(`yuyan:draft:${id}`), id)).toContain('保留冲突草稿')
  await expect(page.locator('.yy-mermaid-svg svg')).toHaveCount(0)
})

test('an unavailable editor route offers a refresh without a reload loop', async ({ page, request }) => {
  const id = await createDoc(request)
  const recover = await failChunk(page, /\/EditView-[^/]+\.js$/)
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.yy-module-notice')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toHaveCount(0)
  await recover()
  await page.getByRole('button', { name: '刷新页面', exact: true }).click()
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect(page.locator('.yy-module-notice')).toHaveCount(0)
})
