import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc } from '../src/schema/markdown'
import { openSidebar } from './sidebar'

async function createDoc(request: APIRequestContext, content: string | JSONContent) {
  const books = await (await request.get('api/books')).json()
  const bookId = books.find((b: { name: string }) => b.name === '读书摘录（示例）').id
  const { id } = await (await request.post('api/docs', { data: { bookId, kind: 'doc', title: '编辑交互样例' } })).json()
  expect((await request.put(`api/docs/${id}`, { data: { title: '编辑交互样例', baseRevision: 1, content: typeof content === 'string' ? markdownToDoc(content) : content } })).ok()).toBe(true)
  return id as number
}

async function openEditor(page: Page, id: number) {
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.yy-save-text')).toHaveText('已保存')
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror, .yy-title-input'))).toBe(true)
}

const help = (page: Page) => page.getByRole('dialog', { name: '快捷键', exact: true })
const levels = (page: Page) => page.locator('.ProseMirror').evaluate((el: any) => {
  const result: number[] = []
  el.editor.state.doc.descendants((n: any) => { if (n.type.name === 'heading') result.push(n.attrs.level) })
  return result
})

test('Escape twice saves the latest title and body before returning to reading; hints and interrupted sequences stay safe', async ({ page, request }) => {
  const id = await createDoc(request, '原文')
  await openEditor(page, id)
  await page.keyboard.press('Escape')
  await expect(page.locator('.yy-toast')).toContainText('连按两次 Esc 键保存并回到阅读模式')
  await expect(page).toHaveURL(/\/edit$/)
  // Typing between presses starts a new sequence; held keys and composition do not finish it.
  await page.keyboard.press('Escape')
  await page.keyboard.type('新增')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/edit$/)
  await page.locator('.ProseMirror').dispatchEvent('keydown', { key: 'Escape', repeat: true })
  await page.locator('.ProseMirror').dispatchEvent('keydown', { key: 'Escape', isComposing: true })
  await expect(page).toHaveURL(/\/edit$/)
  await page.locator('.yy-title-input').fill('已修改的标题')
  await page.route(`**/api/docs/${id}`, async route => {
    if (route.request().method() === 'PUT') await new Promise(resolve => setTimeout(resolve, 500))
    await route.continue()
  })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('.yy-doc-title')).toHaveText('已修改的标题')
  await expect(page.locator('.yy-content')).toContainText('新增原文')
  await expect(page.locator('.yy-toast').filter({ hasText: '连按两次 Esc' })).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.yy-content')).toContainText('新增原文')
  await page.keyboard.press('e')
  await expect(page.locator('.yy-toast')).toContainText('连按两次 E 键进入编辑模式')
  await page.keyboard.press('e')
  await page.keyboard.press('e')
  await expect(page.locator('.ProseMirror')).toBeVisible()
})

test('Escape used by panels never counts toward saving, and save conflicts keep the editor open', async ({ page, request }) => {
  const id = await createDoc(request, '原文')
  await openEditor(page, id)
  for (const combo of ['ControlOrMeta+/', 'ControlOrMeta+k', 'ControlOrMeta+f']) {
    await page.keyboard.press(combo)
    const panel = page.locator('[role="dialog"], .yy-find')
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.yy-toast')).toContainText('连按两次 Esc')
    await expect(page).toHaveURL(/\/edit$/)
  }
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('保留草稿')
  await page.route(`**/api/docs/${id}`, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'revision conflict', revision: 3 }) })
    else await route.continue()
  })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '还有修改没有保存到服务器' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).last().click()
  await expect(page).toHaveURL(/\/edit$/)
  expect(await page.evaluate(id => localStorage.getItem(`yuyan:draft:${id}`), id)).toContain('保留草稿')
})

for (const width of [1360, 375]) {
  test(`shortcut help opens globally and from the appearance menu at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 860 })
    const id = await createDoc(request, '正文')
    for (const path of ['', 'trash', `docs/${id}`, `docs/${id}/edit`]) {
      await page.goto(path)
      if (path.endsWith('/edit')) await expect(page.locator('.yy-save-text')).toHaveText('已保存')
      await page.keyboard.press('ControlOrMeta+/')
      await expect(help(page)).toBeVisible()
      await expect(help(page)).toContainText('进入编辑模式（阅读时）')
      await expect(help(page)).toContainText('保存并回到阅读模式（编辑时）')
      await expect(help(page).locator('.yy-shortcut-chord', { hasText: 'Esc' }).first()).toHaveAttribute('aria-label', 'Esc 然后 Esc')
      await page.keyboard.press('Escape')
      await expect(help(page)).toHaveCount(0)
    }
    await page.locator('.yy-title-input').focus()
    await page.keyboard.press('ControlOrMeta+/')
    await expect(help(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.yy-title-input')).toBeFocused()
    await openSidebar(page)
    await page.getByRole('button', { name: /^外观/ }).click()
    await page.getByRole('menuitem', { name: '快捷键说明' }).click()
    await expect(help(page)).toBeVisible()
    await expect(help(page).getByRole('tab', { name: '常用' })).toBeFocused()
    const box = (await help(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    await help(page).screenshot({ path: `test-results/writing-shortcuts-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/edit$/)
  })
}

test('global help opens above code dialogs while Escape closes panels before saving', async ({ page, request }) => {
  const id = await createDoc(request, '```js\nconst answer = 42\n```\n\n正文')
  await openEditor(page, id)
  await page.getByRole('button', { name: '放大代码块' }).click()
  const expanded = page.locator('.yy-code-dialog')
  await expect(expanded).toBeVisible()
  await expanded.getByRole('button', { name: '关闭放大视图' }).focus()
  await page.keyboard.press('ControlOrMeta+/')
  await expect(expanded.getByRole('dialog', { name: '快捷键', exact: true })).toBeVisible()
  await expect(help(page).getByRole('tab', { name: '常用' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(help(page)).toHaveCount(0)
  await expect(expanded).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(expanded).toHaveCount(0)
  await expect(page).toHaveURL(/\/edit$/)
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+f')
  await expect(page.getByRole('textbox', { name: '在此代码块中查找' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('.yy-toast')).toContainText('连按两次 Esc')
  await expect(page).toHaveURL(/\/edit$/)
})

test('heading levels change together, preserve text and formatting, and stop at either boundary', async ({ page, request }) => {
  const id = await createDoc(request, '## **二级**\n\n正文\n\n> ### 三级\n\n###### 选区外六级')
  await openEditor(page, id)
  const promote = page.getByRole('button', { name: '提升标题等级', exact: true })
  const demote = page.getByRole('button', { name: '降低标题等级', exact: true })
  await page.locator('.ProseMirror').evaluate((el: any) => {
    let end = 0
    el.editor.state.doc.descendants((n: any, pos: number) => { if (n.textContent === '三级' && n.type.name === 'heading') end = pos + n.nodeSize - 1 })
    el.editor.commands.setTextSelection({ from: 2, to: end })
  })
  await promote.click()
  expect(await levels(page)).toEqual([1, 2, 6])
  await expect(promote).toBeDisabled()
  await expect(page.locator('.ProseMirror h1 strong')).toHaveText('二级')
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('正文')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await levels(page)).toEqual([2, 3, 6])
  await demote.click()
  expect(await levels(page)).toEqual([3, 4, 6])
  await page.locator('.ProseMirror').evaluate((el: any) => el.editor.commands.selectAll())
  await expect(demote).toBeDisabled()
  expect(await levels(page)).toEqual([3, 4, 6])
  // A paragraph cursor cannot become a heading; a heading cursor adjusts only that heading.
  await page.locator('.ProseMirror > p').first().click()
  await expect(promote).toBeDisabled()
  await expect(demote).toBeDisabled()
  await page.locator('.ProseMirror h3').click()
  await promote.click()
  expect(await levels(page)).toEqual([2, 4, 6])
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.locator('.yy-content h2')).toHaveText('二级')
  await expect(page.locator('.yy-content blockquote h4')).toHaveText('三级')
})

for (const width of [1360, 375]) {
  test(`list markers cycle through nested and mixed lists in both modes at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 860 })
    const list = (types: string[], depth = 0): JSONContent => ({
      type: types[depth], attrs: types[depth] === 'orderedList' ? { start: depth === 0 ? 3 : 1 } : {},
      content: [{ type: 'listItem', content: [
        { type: 'paragraph', content: [{ type: 'text', text: `第 ${depth + 1} 层` }] },
        ...(depth < types.length - 1 ? [list(types, depth + 1)] : []),
      ] }],
    })
    const id = await createDoc(request, { type: 'doc', content: [list(Array(7).fill('orderedList')), list(Array(7).fill('bulletList')), list(['orderedList', 'bulletList', 'orderedList', 'bulletList']), markdownToDoc('- [ ] 待办').content![0]] })
    for (const suffix of ['', '/edit']) {
      await page.goto(`docs/${id}${suffix}`)
      await expect(page.locator('.yy-content')).toBeVisible()
      const styles = await page.locator('.yy-content ol, .yy-content ul').evaluateAll(els => els.map(el => getComputedStyle(el).listStyleType))
      expect(styles).toEqual(['decimal', 'lower-alpha', 'lower-roman', 'decimal', 'lower-alpha', 'lower-roman', 'decimal', 'disc', 'circle', 'square', 'disc', 'circle', 'square', 'disc', 'decimal', 'circle', 'lower-roman', 'disc', 'none'])
      await expect(page.locator('.yy-content ol').first()).toHaveAttribute('start', '3')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.locator('.yy-content').screenshot({ path: `test-results/lists-${width}${suffix ? '-edit' : ''}.png` })
    }
  })
}
