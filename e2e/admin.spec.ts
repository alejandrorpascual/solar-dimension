import { expect, test, type Page } from '@playwright/test'
import { markEmailVerified } from './db'

const ADMIN = { email: 'e2e-admin@example.com', password: 'correct-horse-battery-admin' }

async function signInOrUp(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  if (await page.getByText(`Signed in as ${email}`).isVisible({ timeout: 3000 }).catch(() => false)) return
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'admin checks run once')
})

test('non-admins get a 404 at /admin/appliances', async ({ page }) => {
  await page.goto('/admin/appliances')
  await expect(page.getByText('Page not found')).toBeVisible()
  await signInOrUp(page, `e2e-${Date.now()}@example.com`, 'correct-horse-battery')
  await page.goto('/admin/appliances')
  await expect(page.getByText('Page not found')).toBeVisible()
})

test('an admin adds an appliance, sees it in the picker, and retires it', async ({ page }) => {
  await signInOrUp(page, ADMIN.email, ADMIN.password)
  await markEmailVerified(ADMIN.email)
  // The session cookie caches the user for 5 minutes; a fresh sign-in picks up email_verified.
  await page.context().clearCookies()
  await signInOrUp(page, ADMIN.email, ADMIN.password)
  const name = `E2E hot plate ${Date.now()}`
  await page.goto('/admin/appliances')
  await page.getByRole('button', { name: 'New appliance' }).click()
  await page.getByLabel('Name (EN)').fill(name)
  await page.getByLabel('Name (ES)').fill(`Parrilla ${name}`)
  await page.getByLabel('Category').selectOption('Kitchen')
  await page.getByLabel('Running watts').fill('1500')
  await page.getByLabel('Surge watts').fill('1500')
  await page.getByLabel('Duty').fill('0.2')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()

  await page.goto('/?step=1')
  await expect(page.getByText(name)).toBeVisible()

  await page.goto('/admin/appliances')
  await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Retire' }).click()
  // Retiring is an async mutation that clears the picker's 60 s cache once it lands; wait for the row to flip to
  // "Restore" (confirming the mutation and the client-side refresh both completed) before checking the picker,
  // otherwise this navigation can race the write and read the cache before it clears.
  await expect(page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Restore' })).toBeVisible()
  await page.goto('/?step=1')
  await expect(page.getByText(name)).toHaveCount(0)
})
