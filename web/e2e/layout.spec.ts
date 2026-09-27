import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { closeDrawer, openSidebar } from './sidebar'

async function createDoc(request: APIRequestContext, title: string, outline = true) {
  const books = (await (await request.get('api/books')).json()) as { id: number; name: string }[]
  const bookId = books.find((b) => b.name === '读书摘录（示例）')!.id
  const { id } = await (await request.post('api/docs', { data: { bookId, parentId: null, kind: 'doc', title } })).json() as { id: number }
  const text = (value: string) => [{ type: 'text', text: value }]
  const content = { type: 'doc', content: [
    ...(outline ? [{ type: 'heading', attrs: { level: 1 }, content: text('章节') }] : []),
    { type: 'paragraph', content: text('正文位置保持不变，侧栏展开和收起时仍在这里。'.repeat(8)) },
  ] }
  expect((await request.put(`api/docs/${id}`, { data: { title, content, baseRevision: 1 } })).ok()).toBeTruthy()
  return id
}

async function geometry(locator: Locator) {
  return locator.evaluate((el) => {
    const { x, width } = el.getBoundingClientRect()
    return { x, width }
  })
}

async function noPageWidthOptions(page: Page) {
  await expect(page.getByRole('menuitem', { name: /标准宽度|宽屏|标准页|宽页/ })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: /代码行号|代码自动换行/ })).toHaveCount(0)
  await expect(page.getByRole('menuitem').first()).toBeVisible()
  await page.keyboard.press('Escape')
}

for (const outline of [true, false]) {
  test(`wide pages keep their position when the sidebar opens and resizes (${outline ? 'outline' : 'no outline'})`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1000 })
    // An older saved standard-page preference must no longer narrow the document, including on reload.
    await page.addInitScript(() => localStorage.setItem('yuyan:prefs', JSON.stringify({ pageWidth: 'standard', sidebarCollapsed: true, sidebarWidth: 480 })))
    const id = await createDoc(request, `宽页位置-${outline}`, outline)
    await page.goto(`docs/${id}`)
    await expect(page.locator('.yy-content')).toBeVisible()
    const read = await geometry(page.locator('.yy-article'))
    expect(read.width).toBe(1100)
    // The former collapsed wide page is centred, with 40/24 px padding when it has an outline.
    expect(read.x).toBe((1920 - 1100) / 2 + (outline ? 8 : 0))

    for (const editing of [false, true]) {
      if (editing) {
        await page.getByRole('link', { name: '编辑', exact: true }).click()
        await expect(page.locator('.ProseMirror')).toBeVisible()
      }
      const body = page.locator(editing ? '.yy-editor-main' : '.yy-article')
      const before = await geometry(body)
      expect(before.width).toBe(1100)
      await openSidebar(page)
      await expect.poll(() => geometry(body)).toEqual(before)
      const sidebar = await page.locator('.yy-sidebar').boundingBox()
      expect(sidebar!.x + sidebar!.width).toBeLessThan(before.x)
      const topbar = await geometry(page.locator('.yy-topbar'))
      expect(topbar.x).toBe(sidebar!.width)
      if (editing) expect((await geometry(page.locator('.yy-toolbar'))).x).toBe(sidebar!.width)

      const resizer = page.locator('.yy-sidebar-resizer')
      await resizer.hover()
      await page.mouse.down()
      await page.mouse.move(200, 300)
      await page.mouse.up()
      await expect.poll(() => page.locator('.yy-sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBe(200)
      await expect.poll(() => geometry(body)).toEqual(before)

      await resizer.hover()
      await page.mouse.down()
      await page.mouse.move(480, 300)
      await page.mouse.up()
      await expect.poll(() => geometry(body)).toEqual(before)
      expect((await geometry(page.locator('.yy-sidebar'))).width).toBeLessThan(before.x)
      await page.screenshot({ path: `test-results/layout-${outline}-${editing ? 'edit' : 'read'}.png` })

      if (!editing) {
        await page.getByRole('button', { name: /^外观/ }).click()
        await noPageWidthOptions(page)
      } else {
        await page.locator('.yy-toolbar').getByRole('button', { name: '更多', exact: true }).click()
        await noPageWidthOptions(page)
      }
      await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
      await expect.poll(() => geometry(body)).toEqual(before)
    }
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible()
    expect((await geometry(page.locator('.yy-editor-main'))).width).toBe(1100)
  })
}

for (const width of [1360, 375]) {
  test(`the sidebar drawer closes outside or after choosing a document at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 860 })
    const title = `抽屉位置-${width}`
    const id = await createDoc(request, title)
    const nextTitle = `抽屉跳转-${width}`
    const nextId = await createDoc(request, nextTitle)
    await page.goto(`docs/${id}`)
    await expect(page.locator('.yy-content')).toBeVisible()
    const article = page.locator('.yy-article')
    const before = await geometry(article)
    await openSidebar(page)
    await expect.poll(() => geometry(article)).toEqual(before)
    await closeDrawer(page)
    await expect.poll(() => geometry(article)).toEqual(before)

    // Choosing the current document closes the drawer too.
    await openSidebar(page)
    await page.locator('.yy-sidebar .yy-tree-title', { hasText: new RegExp(`^${title}$`) }).click()
    await expect(page.locator('.yy-app')).not.toHaveClass(/drawer-open/)
    await openSidebar(page)
    await page.locator('.yy-sidebar .yy-tree-title', { hasText: new RegExp(`^${nextTitle}$`) }).click()
    await expect(page).toHaveURL(new RegExp(`docs/${nextId}$`))
    await expect(page.locator('.yy-app')).not.toHaveClass(/drawer-open/)
    await expect.poll(() => geometry(article)).toEqual(before)

    await page.getByRole('link', { name: '编辑', exact: true }).click()
    const editor = page.locator('.yy-editor-main')
    await expect(page.locator('.ProseMirror')).toBeVisible()
    const editing = await geometry(editor)
    await openSidebar(page)
    await expect.poll(() => geometry(editor)).toEqual(editing)
    await page.screenshot({ path: `test-results/layout-drawer-${width}.png` })
    await closeDrawer(page)
    await page.locator('.yy-toolbar').getByRole('button', { name: '专注模式（隐藏侧栏）', exact: true }).click()
    await openSidebar(page)
    await expect(page.locator('.yy-sidebar')).toBeInViewport()
    await expect.poll(() => geometry(editor)).toEqual(editing)
    await closeDrawer(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}
