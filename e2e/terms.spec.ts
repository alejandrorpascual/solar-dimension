import { expect, test } from '@playwright/test'

test('the terms say results are estimates for an electrician to check, and sign-in links to them', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Terms' }).click()
  await expect(page).toHaveURL(/\/terms$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible()
  await expect(page.getByText('Have a licensed electrician check the design')).toBeVisible()
  await expect(page.getByRole('link', { name: 'alexandros2707@gmail.com' })).toHaveAttribute('href', 'mailto:alexandros2707@gmail.com')
})

test('the terms are translated', async ({ page, context }) => {
  await context.addCookies([{ name: 'lang', value: 'es', url: 'http://localhost:3000' }])
  const res = await page.goto('/terms')
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Términos de uso' })).toBeVisible()
})
