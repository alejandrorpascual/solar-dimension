import { expect, test } from '@playwright/test'

// Google's branding check compares the consent screen's app name with the name shown on the home page,
// and Search Console reads the verification tag from the home page HTML.
test('the home page shows the app name in both languages and carries the Search Console tag', async ({ page, context }) => {
  const res = await page.goto('/')
  const html = await res!.text()
  expect(html).toContain('<meta name="google-site-verification" content="G9yqTKOqSP1tOS4jjC6xGCcsVFT7J3iZC5AzXQ2LNFY"')
  await expect(page.locator('header').getByText('Solar Dimension', { exact: true })).toBeVisible()
  await expect(page).toHaveTitle('Solar Dimension')
  await context.addCookies([{ name: 'lang', value: 'es', url: 'http://localhost:3000' }])
  await page.reload()
  await expect(page.locator('header').getByText('Solar Dimension', { exact: true })).toBeVisible()
})
