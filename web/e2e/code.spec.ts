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
  expect(await page.locator('.yy-code-gutter').last().evaluate(el => getComputedStyle(el, '::before').content)).toBe('"7"')
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

test('JetBrains keys indent, comment and duplicate lines while language changes retain the caret', async ({ page, request }) => {
  const id = await createCode(request, 'if (true) {}')
  await page.goto(`docs/${id}/edit`)
  await expect.poll(() => page.locator('.yy-code-editor-host').evaluate((el: any) => el.codeEditor.view.state.languageDataAt('commentTokens', 0).length)).toBeGreaterThan(0)
  await page.getByRole('button', { name: '代码块更多操作' }).click()
  await expect(page.getByRole('menuitem', { name: /缩进|跳转到行/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await selectCode(page, 11)
  await page.keyboard.press('Enter')
  await expect.poll(() => source(page)).toBe('if (true) {\n    \n}')
  await page.keyboard.type('hello()')
  await expect.poll(() => source(page)).toBe('if (true) {\n    hello()\n}')
  await page.keyboard.press('ControlOrMeta+/')
  await expect.poll(() => source(page)).toContain('    // hello()')
  await expect(page.getByRole('dialog', { name: '快捷键' })).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+/')
  await expect.poll(() => source(page)).toContain('    hello()')
  await page.keyboard.press('ControlOrMeta+d')
  await expect.poll(() => source(page)).toBe('if (true) {\n    hello()\n    hello()\n}')
  const caret = await page.locator('.yy-code-editor-host').evaluate((el: any) => el.codeEditor.view.state.selection.main.head)
  await page.getByRole('button', { name: '代码语言', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索语言' }).fill('ts')
  await page.getByRole('option', { name: /TypeScript/ }).click()
  await expect.poll(() => page.locator('.yy-code-editor-host').evaluate((el: any) => el.codeEditor.view.state.selection.main.head)).toBe(caret)
})

test('reading code expands on a narrow screen with local search and no line-navigation action', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const text = Array.from({ length: 80 }, (_, i) => `const value${i + 1} = ${i + 1}`).join('\n')
  const id = await createCode(request, text)
  await page.goto(`docs/${id}`)
  await page.getByRole('button', { name: '放大代码块' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '跳转到行', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '查找', exact: true }).click()
  await dialog.getByRole('textbox', { name: '在此代码块中查找' }).fill('value80')
  await expect(dialog.locator('.yy-code-search-count')).toHaveText('1/1')
  await expect(dialog.getByRole('textbox', { name: '代码替换为' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await page.getByRole('button', { name: '关闭放大视图' }).click()
  await expect(dialog).toHaveCount(0)
  expect((await (await request.get(`api/docs/${id}`)).json()).revision).toBe(2)
})

for (const example of [
  { language: 'cpp', input: 'int main(){int x=1;if(x){return x;}return 0;}', contains: '\n    int x = 1;' },
  { language: 'javascript', input: 'function hello(){const x={a:1,b:2};return x}', contains: '\n    const x = { a: 1, b: 2 };' },
  { language: 'json', input: '{"items":[1,2],"flag":true}', contains: '\n    "items": [\n        1,\n        2\n    ]' },
  { language: 'python', input: 'def answer():\n return 1+2', contains: '\n    return 1 + 2' },
  { language: 'go', input: 'package main\nfunc main(){text:=`first\n\tsecond`\nif text!=""{println(text)}}', contains: '\n    text := `first\n\tsecond`' },
  { language: 'css', input: 'a{color:red;margin:0}', contains: '\n    color: red;' },
]) {
  test(`formatting ${example.language} edits only this block and is one undo step`, async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const id = await createCode(request, example.input, example.language)
    await page.goto(`docs/${id}/edit`)
    await page.getByRole('button', { name: '代码块更多操作' }).click()
    await page.getByRole('menuitem', { name: '格式化代码', exact: true }).click()
    await expect(page.locator('.yy-code-format-status')).toHaveText('已格式化，可撤销')
    const formatted = await source(page)
    expect(formatted).toContain(example.contains)
    await expect(page.locator('.ProseMirror > p').first()).toHaveText('代码之前')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('代码之后')
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => source(page)).toBe(example.input)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => source(page)).toBe(formatted)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    const saved = await (await request.get(`api/docs/${id}`)).json()
    expect(saved.content.content.find((node: any) => node.type === 'codeBlock').content[0].text).toBe(formatted)
    expect(errors).toEqual([])
  })
}

test('formatting rejects syntax errors and never overwrites typing while the formatter loads', async ({ page, request }) => {
  const id = await createCode(request, 'function () {')
  await page.goto(`docs/${id}/edit`)
  await selectCode(page, 0)
  await page.keyboard.press('ControlOrMeta+Alt+l')
  await expect(page.locator('.yy-code-format-status')).toHaveText('无法格式化，请检查代码语法')
  expect(await source(page)).toBe('function () {')
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('**/format.worker-*.js', async route => { await waiting; await route.continue() })
  const valid = await createCode(request, 'const keep=1')
  await page.goto(`docs/${valid}/edit`)
  await selectCode(page, 12)
  await page.keyboard.press('ControlOrMeta+Alt+l')
  await expect(page.locator('.yy-code-format-status')).toHaveText('正在格式化…')
  await page.keyboard.type(' // typing')
  release()
  await expect(page.locator('.yy-code-format-status')).toHaveText('代码已变化，请重新格式化')
  expect(await source(page)).toBe('const keep=1 // typing')
})

for (const width of [1360, 375]) {
  test(`code menus follow their buttons and contain wheel gestures at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 667 })
    const id = await createCode(request, 'const answer = 42')
    const doc = await (await request.get(`api/docs/${id}`)).json()
    const padding = Array.from({ length: 22 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `正文第 ${i + 1} 段` }] }))
    await request.put(`api/docs/${id}`, { data: { title: doc.title, baseRevision: doc.revision, content: { type: 'doc', content: [...padding, ...doc.content.content, ...padding] } } })
    for (const editing of [false, true]) {
      await page.goto(`docs/${id}${editing ? '/edit' : ''}`)
      const block = page.locator(editing ? '.yy-codeblock' : '.code-block')
      await expect(block).toBeVisible()
      for (const language of editing ? [false, true] : [false]) {
        await block.evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 220))
        const trigger = block.getByRole('button', { name: language ? '代码语言' : '代码块更多操作', exact: true })
        await trigger.click()
        const popup = page.locator(language ? '.yy-lang-panel' : '.yy-code-menu')
        await expect(popup).toBeVisible()
        const before = await page.evaluate(() => scrollY)
        const rect = (await popup.boundingBox())!
        for (const delta of [-250, 250, -250]) {
          for (let i = 0; i < 5; i++) {
            await page.mouse.move(rect.x + 18 + i * 7, rect.y + 65 + (i % 3) * 22)
            await page.mouse.wheel(0, delta)
            await page.waitForTimeout(25)
          }
          expect(await page.evaluate(() => scrollY)).toBe(before)
        }
        if (language) expect(await popup.locator('.yy-lang-list').evaluate(el => el.scrollTop)).toBe(0)
        const top = (await popup.boundingBox())!.y
        // Move outside the popup; normal prose scrolling moves the anchored menu with it.
        await page.mouse.move(width < 500 ? 12 : 80, 620)
        await page.mouse.wheel(0, 90)
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before)
        await expect.poll(async () => Math.abs((await popup.boundingBox())!.y - top + (await page.evaluate(() => scrollY)) - before)).toBeLessThan(3)
        await trigger.evaluate(el => {
          const edge = (document.querySelector('.yy-toolbar') ?? document.querySelector('.yy-topbar'))!.getBoundingClientRect().bottom
          window.scrollBy(0, el.getBoundingClientRect().bottom - edge + 1)
        })
        await expect(popup).not.toBeVisible()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await page.keyboard.press('Escape')
      }
    }
  })
}

for (const platform of ['MacIntel', 'Win32']) {
  test(`JetBrains shortcuts and their help agree on ${platform}`, async ({ page, request }) => {
    await page.addInitScript(value => Object.defineProperty(navigator, 'platform', { get: () => value }), platform)
    const mod = platform === 'MacIntel' ? 'Meta' : 'Control'
    const original = 'const alpha = 1\nconst beta = 2\nconst gamma = 3'
    const id = await createCode(request, original)
    await page.goto(`docs/${id}/edit`)
    await expect(page.locator('.cm-content')).toBeVisible()
    await selectCode(page, original.indexOf('beta'))
    await page.keyboard.press(`${mod}+d`)
    await expect.poll(() => source(page)).toBe('const alpha = 1\nconst beta = 2\nconst beta = 2\nconst gamma = 3')
    await page.keyboard.press(`${mod}+z`)
    await expect.poll(() => source(page)).toBe(original)
    await selectCode(page, 6, 11)
    await page.keyboard.press(`${mod}+d`)
    await expect.poll(() => source(page)).toBe(original.replace('alpha', 'alphaalpha'))
    await page.keyboard.press(`${mod}+z`)
    await expect.poll(() => source(page)).toBe(original)
    await selectCode(page, 6, 11)
    // A physical Shift+/ reports "?"; Playwright otherwise sends a literal "/" with Shift held.
    await page.keyboard.press(platform === 'MacIntel' ? 'Meta+Alt+/' : 'Control+Shift+?')
    await expect.poll(() => source(page)).toContain('/* alpha */')
    await page.keyboard.press(`${mod}+z`)
    await expect.poll(() => source(page)).toBe(original)
    await page.keyboard.press(`${mod}+Shift+k`)
    expect(await source(page)).toBe(original)
    await selectCode(page, original.indexOf('beta'))
    await page.keyboard.press(platform === 'MacIntel' ? 'Meta+Backspace' : 'Control+y')
    await expect.poll(() => source(page)).toBe('const alpha = 1\nconst gamma = 3')
    await page.keyboard.press(`${mod}+z`)
    await expect.poll(() => source(page)).toBe(original)
    await selectCode(page, original.indexOf('beta'))
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await expect.poll(() => source(page)).toBe('const alpha = 1\nconst gamma = 3\nconst beta = 2')
    await page.keyboard.press(`${mod}+Alt+l`)
    await expect(page.locator('.yy-code-format-status')).toHaveText('已格式化，可撤销')
    await selectCode(page, 0, 5)
    await page.keyboard.press(platform === 'MacIntel' ? 'Control+g' : 'Alt+j')
    await expect.poll(() => page.locator('.yy-code-editor-host').evaluate((el: any) => el.codeEditor.view.state.selection.ranges.length)).toBe(2)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${mod}+r`)
    await expect(page.getByRole('textbox', { name: '代码替换为' })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '代码块更多操作' }).click()
    await page.getByRole('menuitem', { name: '代码块快捷键' }).click()
    const help = page.getByRole('dialog', { name: '代码块快捷键', exact: true })
    await expect(help).toContainText('JetBrains 默认方案')
    await expect(help.locator('.yy-shortcut-row').filter({ hasText: '删除当前行' }).locator('.yy-shortcut-chord')).toHaveAttribute('aria-label', platform === 'MacIntel' ? 'Command + Backspace' : 'Ctrl + Y')
    await expect(help).not.toContainText('跳转到行')
    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)
    await page.getByRole('button', { name: '放大代码块' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '代码块更多操作' }).click()
    await page.getByRole('menuitem', { name: '代码块快捷键' }).click()
    await expect(help).toBeVisible()
    await help.getByRole('button', { name: '关闭代码块快捷键' }).click()
    await expect(page.locator('.yy-code-dialog')).toBeVisible()
  })
}

for (const width of [1360, 375]) {
  test(`code gutters stay fixed while long lines scroll horizontally at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 667 })
    const id = await createCode(request, `function example() {\n    return "${'long code '.repeat(90)}"\n}`)
    for (const editing of [false, true]) {
      await page.goto(`docs/${id}${editing ? '/edit' : ''}`)
      const block = page.locator(editing ? '.yy-codeblock' : '.code-block')
      await block.hover()
      const scroller = block.locator(editing ? '.cm-scroller' : 'pre > code')
      const gutter = block.locator(editing ? '.cm-lineNumbers .cm-gutterElement:not(:first-child)' : '.yy-code-line-select')
      await expect(gutter).toHaveCount(3)
      const start = (await gutter.first().boundingBox())!.x
      const line = block.locator(editing ? '.cm-line' : '.yy-line').first()
      const textStart = (await line.boundingBox())!.x
      const rect = (await scroller.boundingBox())!
      await page.mouse.move(rect.x + rect.width / 2, rect.y + 25)
      await page.mouse.wheel(360, 0)
      await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(100)
      expect((await line.boundingBox())!.x).toBeLessThan(textStart - 100)
      for (const item of [gutter.first(), gutter.last()]) expect(Math.abs((await item.boundingBox())!.x - start)).toBeLessThan(1)
      // Short lines keep their gutter even after scrolling to the end of a much longer line.
      await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth })
      for (const item of [gutter.first(), gutter.last()]) expect(Math.abs((await item.boundingBox())!.x - start)).toBeLessThan(1)
      await block.screenshot({ path: `test-results/code-gutters-${width}-${editing ? 'edit' : 'read'}.png` })
      await gutter.last().click()
      if (!editing) expect(await page.evaluate(() => getSelection()?.toString())).toBe('}')
      else expect(await block.locator('.yy-code-editor-host').evaluate((el: any) => {
        const view = el.codeEditor.view; return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      })).toBe('}')
    }
  })
}

for (const width of [1360, 375]) {
  test(`shortcut reference stays readable and navigable at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 667 })
    const id = await createCode(request, 'const example = 1')
    await page.goto(`docs/${id}/edit`)
    await page.locator('.ProseMirror > p').first().click()
    await page.keyboard.press('ControlOrMeta+/')
    const help = page.getByRole('dialog', { name: '快捷键', exact: true })
    await expect(help.getByRole('tab', { name: '常用', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(help.getByRole('tab', { name: 'Markdown', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(help.getByRole('tabpanel')).toContainText('公式块')
    await page.keyboard.press('ArrowLeft')
    await expect(help.getByRole('tabpanel')).toContainText('JetBrains 默认方案')
    await expect(help.locator('.yy-shortcut-row').filter({ hasText: '格式化代码' }).locator('kbd')).toHaveCount(3)
    await help.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    const box = (await help.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(box.y + box.height).toBeLessThanOrEqual(667)
    expect(await help.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(2)
    const nav = (await help.getByRole('tablist').boundingBox())!
    const body = help.getByRole('tabpanel'), rect = (await body.boundingBox())!
    const pageTop = await page.evaluate(() => scrollY)
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.mouse.wheel(0, 800)
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    expect((await help.getByRole('tablist').boundingBox())!.y).toBe(nav.y)
    expect(await page.evaluate(() => scrollY)).toBe(pageTop)
    await body.evaluate(el => { el.scrollTop = 0 })
    await help.screenshot({ path: `test-results/shortcuts-${width}.png` })
    await page.locator('html').evaluate(el => { el.dataset.theme = 'dark' })
    await help.screenshot({ path: `test-results/shortcuts-${width}-dark.png` })
    await help.getByRole('button', { name: '关闭快捷键', exact: true }).click()
    await expect(help).toHaveCount(0)

    // The reading page loads the standalone reference without the editor's stylesheet.
    await page.goto(`docs/${id}`)
    await page.getByRole('button', { name: '代码块更多操作' }).click()
    await page.getByRole('menuitem', { name: '代码块快捷键' }).click()
    const codeHelp = page.getByRole('dialog', { name: '代码块快捷键', exact: true })
    const codeBox = (await codeHelp.boundingBox())!
    expect(codeBox.x).toBeGreaterThanOrEqual(0)
    expect(codeBox.x + codeBox.width).toBeLessThanOrEqual(width)
    expect(codeBox.y + codeBox.height).toBeLessThanOrEqual(667)
    const codeBody = codeHelp.locator('.yy-shortcuts-body')
    expect(await codeBody.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(2)
    await codeHelp.screenshot({ path: `test-results/code-shortcuts-${width}.png` })
    if (width < 500) {
      const headerTop = (await codeHelp.locator('h2').boundingBox())!.y
      await codeBody.hover()
      await page.mouse.wheel(0, 800)
      await expect.poll(() => codeBody.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      expect((await codeHelp.locator('h2').boundingBox())!.y).toBe(headerTop)
    }
    await codeHelp.getByRole('button', { name: '关闭代码块快捷键' }).click()
    await expect(codeHelp).toHaveCount(0)
  })
}
