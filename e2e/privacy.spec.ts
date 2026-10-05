import { expect, test } from '@playwright/test'

test('the privacy page says what is stored and how to delete it, and sign-in links to it', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Privacy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
  await expect(page.getByText("We don't sell or share your data")).toBeVisible()
  await expect(page.getByText('client details for the spec sheet', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'alexandros2707@gmail.com' })).toHaveAttribute('href', 'mailto:alexandros2707@gmail.com')
})

test('the privacy page is translated', async ({ page, context }) => {
  await context.addCookies([{ name: 'lang', value: 'es', url: 'http://localhost:3000' }])
  const res = await page.goto('/privacy')
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Privacidad' })).toBeVisible()
})
