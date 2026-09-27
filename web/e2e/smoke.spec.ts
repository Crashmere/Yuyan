import { expect, test, type Page } from '@playwright/test'
import { openSidebar } from './sidebar'

// Titles come from the synthetic data written by tools/demo/seed.ts.

const nativeDialogs = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const seen: string[] = []
  nativeDialogs.set(page, seen)
  page.on('dialog', (d) => {
    seen.push(`${d.type()}: ${d.message()}`)
    void d.dismiss()
  })
})

test.afterEach(({ page }) => {
  expect(nativeDialogs.get(page), 'browser dialogs must not be used').toEqual([])
})

function treeRow(page: Page, title: string) {
  return page.locator('.yy-sidebar .yy-tree-row').filter({ has: page.locator('.yy-tree-title', { hasText: new RegExp(`^${title}$`) }) })
}

// The list of children follows a node's row inside its item.
function treeChildren(page: Page, title: string) {
  return treeRow(page, title).locator('xpath=following-sibling::ul[1]')
}

test('home lists the knowledge bases', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '知识库' })).toBeVisible()
  await expect(page.locator('.yy-book-card', { hasText: '产品手册（示例）' })).toBeVisible()
  await expect(page.locator('.yy-book-card', { hasText: '算法笔记（示例）' })).toBeVisible()
})

test('a document opens with its content and outline', async ({ page }) => {
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '产品手册（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '长文档示例' }).click()
  await expect(page.locator('.yy-doc-title')).toHaveText('长文档示例')
  await expect(page.locator('.yy-content .callout')).toHaveCount(1)
  await page.locator('.yy-toc a', { hasText: /^表格$/ }).click()
  await expect(page.locator('.yy-content h2', { hasText: '表格' })).toBeInViewport()
})

test('edits are saved automatically and shown after reload', async ({ page }) => {
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '产品手册（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '快速开始' }).click()
  await page.getByRole('link', { name: '编辑' }).click()
  const editor = page.locator('.ProseMirror')
  await expect(editor).toBeVisible()
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/docs\/\d+$/.test(r.url()) && r.ok())
  await editor.locator(':scope > p').last().click()
  await page.keyboard.type('端到端测试写入的内容')
  await saved
  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.locator('.yy-content')).toContainText('端到端测试写入的内容')
  await page.reload()
  await expect(page.locator('.yy-content')).toContainText('端到端测试写入的内容')
})

test('a document dragged onto a group moves into it', async ({ page }) => {
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '产品手册（示例）' }).click()
  await page.locator('.yy-catalog-title', { hasText: '常见问题' }).click()
  await openSidebar(page)
  const moved = page.waitForResponse((r) => r.url().endsWith('/move') && r.ok())
  await treeRow(page, '常见问题').dragTo(treeRow(page, '入门'))
  await moved
  await expect(treeChildren(page, '入门')).toContainText('常见问题')
  await page.reload()
  await openSidebar(page)
  await expect(treeChildren(page, '入门')).toContainText('常见问题')
})

test('a deleted document comes back from the trash', async ({ page }) => {
  await page.goto('./')
  await page.locator('.yy-book-card', { hasText: '算法笔记（示例）' }).click()
  await openSidebar(page)
  await treeRow(page, '复杂度速查').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.locator('.yy-dialog').getByRole('button', { name: '删除' }).click()
  await expect(treeRow(page, '复杂度速查')).toHaveCount(0)
  await page.locator('.yy-sidebar').getByRole('link', { name: '回收站' }).click()
  const item = page.locator('.yy-trash-list li', { hasText: '复杂度速查' })
  await item.getByRole('button', { name: '恢复' }).click()
  await expect(item).toHaveCount(0)
  await openSidebar(page)
  await page.locator('.yy-sidebar').getByRole('link', { name: '算法笔记（示例）' }).click()
  await openSidebar(page)
  await expect(treeRow(page, '复杂度速查')).toBeVisible()
})
