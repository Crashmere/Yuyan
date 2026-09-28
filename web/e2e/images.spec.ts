import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'

const heading = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const paragraph = (content?: JSONContent[]): JSONContent => ({ type: 'paragraph', content })

async function openImageDoc(page: Page, request: APIRequestContext, aligned = false, blanks = false) {
  await page.goto('./')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 400; canvas.height = 240
    const context = canvas.getContext('2d')!
    context.fillStyle = '#2c8c70'; context.fillRect(0, 0, 400, 240)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  const { url } = await (await request.post('api/assets', { multipart: { file: { name: 'image.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') } } })).json()
  const books = await (await request.get('api/books')).json()
  const bookId = books.find((b: { name: string }) => b.name === '读书摘录（示例）').id
  const { id } = await (await request.post('api/docs', { data: { bookId, title: '图片边界样例', kind: 'doc' } })).json()
  const image: JSONContent = { type: 'image', attrs: { src: url, width: 180, blockAlign: aligned ? 'center' : null } }
  const content = { type: 'doc', content: [
    heading(2, '上方标题'), ...(blanks ? [paragraph()] : []), paragraph([image]),
    ...(blanks ? [paragraph()] : []), heading(3, '下方标题'), paragraph([{ type: 'text', text: '结尾正文' }]),
  ] }
  expect((await request.put(`api/docs/${id}`, { data: { title: '图片边界样例', baseRevision: 1, content } })).ok()).toBe(true)
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.yy-save-text')).toHaveText('已保存')
  await expect(page.locator('.yy-image img')).toBeVisible()
  await expect.poll(() => page.locator('.yy-image img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  return id as number
}

const documentJSON = (page: Page): Promise<JSONContent> => page.locator('.ProseMirror').evaluate((el: any) => el.editor.getJSON())
async function place(page: Page, position: 'before' | 'after' | 'previous-end' | 'next-start') {
  await page.locator('.ProseMirror').evaluate((el: any, position) => {
    const editor = el.editor
    let pos = 0
    editor.state.doc.descendants((node: any, at: number) => {
      if (node.type.name !== 'image') return
      const resolved = editor.state.doc.resolve(at)
      pos = position === 'before' ? at : position === 'after' ? at + node.nodeSize
        : position === 'previous-end' ? resolved.before() - 1 : resolved.after() + 1
    })
    editor.commands.setTextSelection(pos)
    editor.view.focus()
  }, position)
}

for (const width of [1360, 375]) {
  test(`aligning an image adds no empty lines and preserves resize handles at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 860 })
    const id = await openImageDoc(page, request)
    const image = page.locator('.yy-image img')
    const layout = () => image.evaluate(img => {
      const box = img.getBoundingClientRect(), p = img.closest('p')!.getBoundingClientRect()
      return { gap: p.height - box.height, height: p.height, topGap: box.top - p.top }
    })
    const before = await documentJSON(page)
    const beforeLayout = await layout()
    for (const name of ['图片居中', '图片右对齐', '图片左对齐']) {
      await image.click()
      await page.locator('.yy-toolbar').getByRole('button', { name: '对齐', exact: true }).click()
      await page.getByRole('menuitem', { name, exact: true }).click()
      await expect.poll(async () => Math.abs((await layout()).height - beforeLayout.height)).toBeLessThan(2)
      expect((await layout()).topGap).toBeLessThan(2)
      expect((await documentJSON(page)).content!.map(n => n.type)).toEqual(before.content!.map(n => n.type))
      const edges = await page.locator('.yy-image').evaluate(el => {
        const img = el.querySelector('img')!.getBoundingClientRect()
        const left = el.querySelector('.yy-image-handle.left')!.getBoundingClientRect()
        const right = el.querySelector('.yy-image-handle.right')!.getBoundingClientRect()
        return [Math.abs(left.left + left.width / 2 - img.left), Math.abs(right.left + right.width / 2 - img.right)]
      })
      expect(Math.max(...edges)).toBeLessThan(2)
    }
    await page.keyboard.press('ControlOrMeta+z')
    expect((await documentJSON(page)).content![1]!.content![0]!.attrs!.blockAlign).toBe('right')
    const handle = await page.locator('.yy-image-handle.right').boundingBox()
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle!.x + handle!.width / 2 + 24, handle!.y + handle!.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect(image).toHaveAttribute('width', '204')
    expect((await layout()).gap).toBeLessThan(2)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page.locator('.ProseMirror')).toHaveCount(0)
    await expect(page.locator('.yy-content img')).toHaveAttribute('data-align', 'right')
    await page.goto(`docs/${id}/edit`)
    await expect(page.locator('.yy-save-text')).toHaveText('已保存')
    await expect.poll(async () => (await layout()).gap).toBeLessThan(2)
  })
}

test('image boundaries never join the surrounding headings, and deletion selects the image first', async ({ page, request }) => {
  await openImageDoc(page, request, true)
  const original = await documentJSON(page)
  for (const [position, key] of [['before', 'Backspace'], ['after', 'Delete']] as const) {
    await place(page, position)
    await page.keyboard.press(key)
    expect(await documentJSON(page)).toEqual(original)
    expect(await page.locator('.ProseMirror').evaluate((el: any) => el.editor.state.selection.$from.parent.type.name)).toBe('heading')
  }
  for (const [position, key] of [['after', 'Backspace'], ['before', 'Delete'], ['next-start', 'Backspace'], ['previous-end', 'Delete']] as const) {
    await place(page, position)
    await page.keyboard.press(key)
    expect(await documentJSON(page)).toEqual(original)
    await expect(page.locator('.yy-image.ProseMirror-selectednode')).toBeVisible()
    await page.keyboard.press(key)
    await expect(page.locator('.yy-image')).toHaveCount(0)
    await expect(page.locator('.ProseMirror h2')).toHaveText('上方标题')
    await expect(page.locator('.ProseMirror h3')).toHaveText('下方标题')
    await page.keyboard.press('ControlOrMeta+z')
    expect(await documentJSON(page)).toEqual(original)
  }
})

test('real empty paragraphs next to aligned images can be removed without deleting the image or changing headings', async ({ page, request }) => {
  await openImageDoc(page, request, true, true)
  const original = await documentJSON(page)
  for (const [position, key] of [['before', 'Backspace'], ['after', 'Delete'], ['next-start', 'Backspace'], ['previous-end', 'Delete']] as const) {
    await place(page, position)
    await page.keyboard.press(key)
    const current = await documentJSON(page)
    expect(current.content).toHaveLength(original.content!.length - 1)
    await expect(page.locator('.yy-image')).toHaveCount(1)
    await expect(page.locator('.ProseMirror h2')).toHaveText('上方标题')
    await expect(page.locator('.ProseMirror h3')).toHaveText('下方标题')
    await page.keyboard.press('ControlOrMeta+z')
    expect(await documentJSON(page)).toEqual(original)
  }
})

test('inline images and deliberate text selections retain normal deletion', async ({ page, request }) => {
  await openImageDoc(page, request)
  await place(page, 'after')
  await page.keyboard.press('Backspace')
  await expect(page.locator('.yy-image')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await page.locator('.yy-image img').click()
  await page.locator('.yy-toolbar').getByRole('button', { name: '对齐', exact: true }).click()
  await page.getByRole('menuitem', { name: '图片居中', exact: true }).click()
  await page.locator('.ProseMirror').evaluate((el: any) => {
    const editor = el.editor
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
    editor.view.focus()
  })
  await page.keyboard.press('Backspace')
  await expect(page.locator('.yy-image')).toHaveCount(0)
})
