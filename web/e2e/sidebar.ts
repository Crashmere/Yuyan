import { expect, type Page } from '@playwright/test'

export async function openSidebar(page: Page) {
  const drawer = page.getByRole('button', { name: '打开目录', exact: true })
  if (await drawer.isVisible()) {
    if (!(await page.locator('.yy-app.drawer-open').count())) await drawer.click()
    await expect(page.locator('.yy-sidebar')).toHaveCSS('transform', 'none')
  } else {
    const expand = page.getByRole('button', { name: '展开侧栏', exact: true })
    if (await expand.isVisible()) await expand.click()
  }
}

export async function closeDrawer(page: Page) {
  await page.locator('.yy-drawer-mask').click({ position: { x: page.viewportSize()!.width - 16, y: 120 } })
  await expect(page.locator('.yy-app')).not.toHaveClass(/drawer-open/)
  await expect(page.locator('.yy-sidebar')).not.toBeInViewport()
}
