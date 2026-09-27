import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

async function createCode(request: APIRequestContext, source: string, language = 'javascript') {
  const books = await (await request.get('api/books')).json()
  const book = books.find((b: { name: string }) => b.name === '读书摘录（示例）')
  const { id } = await (await request.post('api/docs', { data: { bookId: book.id, parentId: null, kind: 'doc', title: '代码交互验证' } })).json()
  const content = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '代码之前' }] },
    { type: 'codeBlock', attrs: { language, title: '示例代码', collapsed: false }, content: [{ type: 'text', text: source }] },
    { type: 'paragraph', content: [{ type: 'text', text: '代码之后' }] },
  ] }
  expect((await request.put(`api/docs/${id}`, { data: { title: '代码交互验证', content, baseRevision: 1 } })).ok()).toBeTruthy()
  return id as number
}

async function source(page: Page) {
  return page.locator('.ProseMirror').evaluate((el: any) => el.editor.getJSON().content.find((n: any) => n.type === 'codeBlock').content?.map((n: any) => n.text).join('') ?? '')
}

async function selectCode(page: Page, anchor: number, head = anchor) {
  await page.locator('.yy-code-editor-host').first().evaluate((el: any, range) => { el.codeEditor.view.dispatch({ selection: range }); el.codeEditor.view.focus() }, { anchor, head })
}

test('code editor forwards typing, selection and document undo without losing the surrounding text', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original = 'function hello() {\n  return 1\n}\n'
  const id = await createCode(request, original)
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(page.locator('.cm-foldGutter .yy-code-fold-marker:visible').first()).toBeVisible()
  await selectCode(page, original.length)
  await page.keyboard.type('console.log(')
  await expect.poll(() => source(page)).toBe(original + 'console.log()')
  await page.keyboard.type('hello')
  await expect.poll(() => source(page)).toBe(original + 'console.log(hello)')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => source(page)).toBe(original)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => source(page)).toBe(original + 'console.log(hello)')
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('代码之前')
  await expect(page.locator('.ProseMirror > p').last()).toHaveText('代码之后')
  expect(errors).toEqual([])
})

test('code regions fold by syntax in reading and editing, retaining their original line numbers', async ({ page, request }) => {
  const text = 'function outer() {\n  const brace = "}"\n  if (brace) {\n    return 1\n  }\n}\nconst after = 2'
  const id = await createCode(request, text)
  await page.goto(`docs/${id}`)
  await page.locator('.code-block').hover()
  const fold = page.getByRole('button', { name: '折叠第 1 行代码区域', exact: true })
  await expect(fold).toBeVisible()
  await fold.click()
  await expect(page.locator('.yy-line').nth(1)).toBeHidden()
  await expect(page.locator('.yy-line').last()).toBeVisible()
  expect(await page.locator('.yy-line').last().evaluate(el => getComputedStyle(el, '::before').content)).toBe('"7"')
  await page.getByRole('link', { name: '编辑', exact: true }).click()
  await expect(page.locator('.yy-code-fold-placeholder')).toHaveText('⋯ 5 行')
  await page.locator('.yy-code-fold-placeholder').click()
  await expect(page.locator('.cm-content')).toContainText('const brace')
  expect(await source(page)).toBe(text)
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.locator('.code-block').hover()
  await expect(page.locator('.yy-line').nth(1)).toBeVisible()
})

test('code line gutters select a range for removal and document undo', async ({ page, request }) => {
  const text = 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4'
  const id = await createCode(request, text)
  await page.goto(`docs/${id}/edit`)
  const numbers = page.locator('.cm-lineNumbers .cm-gutterElement:visible')
  await expect(numbers).toHaveCount(4)
  const first = (await numbers.nth(0).boundingBox())!, third = (await numbers.nth(2).boundingBox())!
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.yy-selection-toolbar')).toBeVisible()
  await page.locator('.yy-selection-toolbar').getByRole('button', { name: '移除选中内容' }).click()
  await expect.poll(() => source(page)).toBe('const d = 4')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => source(page)).toBe(text)
})

test('reading line selection copies source without gutter or folding controls', async ({ page, request }) => {
  const text = 'function hello() {\n  return 1\n}\nconst after = 2'
  const id = await createCode(request, text)
  await page.goto(`docs/${id}`)
  await page.locator('.code-block').hover()
  await page.getByRole('button', { name: '选择第 1 行代码', exact: true }).click()
  await page.getByRole('button', { name: '选择第 3 行代码', exact: true }).click({ modifiers: ['Shift'] })
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('function hello() {\n  return 1\n}')
})

test('code-only replace and expanded editing share the same saved document', async ({ page, request }) => {
  const text = 'const item = 1\nconsole.log(item)'
  const id = await createCode(request, text)
  await page.goto(`docs/${id}/edit`)
  await selectCode(page, 0)
  await page.keyboard.press('ControlOrMeta+f')
  await expect(page.getByRole('textbox', { name: '在此代码块中查找' })).toBeVisible()
  await expect(page.locator('.yy-find-panel')).toHaveCount(0)
  await page.getByRole('textbox', { name: '在此代码块中查找' }).fill('item')
  await expect(page.locator('.yy-code-search-count')).toHaveText('1/2')
  await page.getByRole('textbox', { name: '代码替换为' }).fill('result')
  await page.getByRole('button', { name: '区分大小写' }).click()
  await page.getByRole('button', { name: '关闭代码查找' }).click()
  await page.keyboard.press('ControlOrMeta+f')
  await expect(page.getByRole('button', { name: '区分大小写' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('textbox', { name: '代码替换为' })).toHaveValue('result')
  await page.getByRole('button', { name: '替换此代码块中的全部匹配' }).click()
  await expect.poll(() => source(page)).toBe('const result = 1\nconsole.log(result)')
  await page.getByRole('button', { name: '关闭代码查找' }).click()
  await page.getByRole('button', { name: '放大代码块' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '代码语言', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索语言' }).fill('python')
  await page.getByRole('option', { name: /Python/ }).click()
  await expect(dialog.getByRole('button', { name: '代码语言', exact: true })).toHaveText('Python')
  await dialog.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(';')
  await page.getByRole('button', { name: '关闭放大视图' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => source(page)).toContain('console.log(result);')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.locator('.yy-content pre code')).toContainText('console.log(result);')
  await page.reload()
  await expect(page.locator('.yy-content pre code')).toContainText('console.log(result);')
})

test('code selection expands to the document and clicking prose leaves the code caret behind', async ({ page, request }) => {
  const text = 'const a = 1\nconst b = 2'
  const id = await createCode(request, text)
  await page.goto(`docs/${id}/edit`)
  await expect(page.locator('.cm-content')).toBeVisible()
  await selectCode(page, 4)
  await page.keyboard.press('ControlOrMeta+a')
  await expect.poll(() => page.locator('.ProseMirror').evaluate((el: any) => el.editor.state.doc.textBetween(el.editor.state.selection.from, el.editor.state.selection.to))).toBe(text)
  await page.keyboard.press('ControlOrMeta+a')
  await expect.poll(() => page.locator('.ProseMirror').evaluate((el: any) => el.editor.state.selection.toJSON().type)).toBe('all')
  await page.locator('.ProseMirror > p').first().click()
  await expect.poll(() => page.locator('.ProseMirror').evaluate((el: any) => el.editor.state.selection.$from.parent.type.name)).toBe('paragraph')
  await page.keyboard.type('x')
  await expect(page.locator('.ProseMirror > p').first()).toContainText('x')
  expect(await source(page)).toBe(text)
})

test('expanded code keeps line removal and undo inside its dialog', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const text = 'const a = 1\nconst b = 2'
  const id = await createCode(request, text)
  await page.goto(`docs/${id}/edit`)
  await page.getByRole('button', { name: '放大代码块' }).click()
  const dialog = page.getByRole('dialog')
  expect((await dialog.getByRole('textbox', { name: '代码块标题' }).boundingBox())!.width).toBeGreaterThan(30)
  await dialog.locator('.cm-lineNumbers .cm-gutterElement:visible').first().click()
  await dialog.getByRole('button', { name: '移除选中内容' }).click()
  await expect.poll(() => source(page)).toBe('const b = 2')
  await dialog.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => source(page)).toBe(text)
  await dialog.getByRole('button', { name: '关闭放大视图' }).click()
  await expect(page.locator('.ProseMirror .cm-content')).toContainText('const a = 1')
})

for (const [language, text] of [
  ['cpp', 'int main() {\n  const char* brace = "}";\n  return 0;\n}\nint after = 1;'],
  ['go', 'func main() {\n  value := "}"\n  println(value)\n}\n// after'],
  ['python', 'def sample():\n    value = "}"\n    return value\nafter = 1'],
  ['json', '{\n  "brace": "}",\n  "values": [1, 2]\n}'],
]) {
  test(`code folding understands ${language} structure`, async ({ page, request }) => {
    const id = await createCode(request, text, language)
    await page.goto(`docs/${id}`)
    await page.locator('.code-block').hover()
    await page.getByRole('button', { name: '折叠第 1 行代码区域', exact: true }).click()
    await expect(page.locator('.yy-line').nth(1)).toBeHidden()
    await page.getByRole('button', { name: '展开第 1 行代码区域', exact: true }).click()
    await expect(page.locator('.yy-line').nth(1)).toBeVisible()
  })
}

test('VS Code keys indent, comment and move lines while language changes retain the caret', async ({ page, request }) => {
  const id = await createCode(request, 'if (true) {}')
  await page.goto(`docs/${id}/edit`)
  await expect.poll(() => page.locator('.yy-code-editor-host').evaluate((el: any) => el.codeEditor.view.state.languageDataAt('commentTokens', 0).length)).toBeGreaterThan(0)
  await page.getByRole('button', { name: '代码块更多操作' }).click()
  await page.getByRole('menuitem', { name: '缩进：2 个空格' }).click()
  await selectCode(page, 11)
  await page.keyboard.press('Enter')
  await expect.poll(() => source(page)).toBe('if (true) {\n  \n}')
  await page.keyboard.type('hello()')
  await expect.poll(() => source(page)).toBe('if (true) {\n  hello()\n}')
  await page.keyboard.press('ControlOrMeta+/')
  await expect.poll(() => source(page)).toContain('  // hello()')
  await expect(page.getByRole('dialog', { name: '快捷键' })).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+/')
  await expect.poll(() => source(page)).toContain('  hello()')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await expect.poll(() => source(page)).toBe('if (true) {\n  hello()\n  hello()\n}')
  const caret = await page.locator('.yy-code-editor-host').evaluate((el: any) => el.codeEditor.view.state.selection.main.head)
  await page.getByRole('button', { name: '代码语言', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索语言' }).fill('ts')
  await page.getByRole('option', { name: /TypeScript/ }).click()
  await expect.poll(() => page.locator('.yy-code-editor-host').evaluate((el: any) => el.codeEditor.view.state.selection.main.head)).toBe(caret)
})

test('reading code expands on a narrow screen with local search and line navigation', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const text = Array.from({ length: 80 }, (_, i) => `const value${i + 1} = ${i + 1}`).join('\n')
  const id = await createCode(request, text)
  await page.goto(`docs/${id}`)
  await page.getByRole('button', { name: '放大代码块' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '跳转到行', exact: true }).click()
  await dialog.getByRole('textbox', { name: '跳转到行:' }).fill('60')
  await dialog.getByRole('textbox', { name: '跳转到行:' }).press('Enter')
  await expect(dialog.locator('.cm-activeLine')).toHaveText('const value60 = 60')
  await dialog.getByRole('button', { name: '查找', exact: true }).click()
  await dialog.getByRole('textbox', { name: '在此代码块中查找' }).fill('value80')
  await expect(dialog.locator('.yy-code-search-count')).toHaveText('1/1')
  await expect(dialog.getByRole('textbox', { name: '代码替换为' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await page.getByRole('button', { name: '关闭放大视图' }).click()
  await expect(dialog).toHaveCount(0)
  expect((await (await request.get(`api/docs/${id}`)).json()).revision).toBe(2)
})
