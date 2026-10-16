import { expect, test, type Page } from '@playwright/test'
import { slugify } from '../src/lib/catalog-schema'
import { deleteTestAppliance, markEmailVerified } from './db'
import { E2E_ADMIN as ADMIN } from './servers'

// The admin tests share the run's one admin account, which the first of them to sign in creates: one at a time, in order.
test.describe.configure({ mode: 'default' })

async function signInOrUp(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const signedIn = page.getByRole('button', { name: `Signed in as ${email}` })
  const failed = page.getByText('That did not work. Check the email and password.')
  await expect(signedIn.or(failed)).toBeVisible()
  if (await signedIn.isVisible()) return
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
}

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
  const id = slugify(name)
  try {
    await page.goto('/admin/appliances')
    await page.getByRole('button', { name: 'New appliance' }).click()
    // A one-letter name slugifies to a one-character id, which fails the schema's id pattern: the error must surface.
    await page.getByLabel('Name (EN)').fill('A')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('The English name must give an id of at least 2 letters or digits')).toBeVisible()

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
  } finally {
    // Runs even if an assertion above throws midway, so no run leaves its e2e appliance behind.
    await deleteTestAppliance(id)
  }
})

test('"New appliance" refuses an id that already belongs to another appliance', async ({ page }) => {
  await signInOrUp(page, ADMIN.email, ADMIN.password)
  await markEmailVerified(ADMIN.email)
  await page.context().clearCookies()
  await signInOrUp(page, ADMIN.email, ADMIN.password)

  await page.goto('/admin/appliances')
  await page.getByRole('button', { name: 'New appliance' }).click()
  // "Toaster" slugifies to the seeded id "toaster"; saving must not silently overwrite it. Every other field has to be
  // valid too, otherwise the form reports the schema error instead of ever reaching the duplicate-id check.
  await page.getByLabel('Name (EN)').fill('Toaster')
  await page.getByLabel('Name (ES)').fill('Tostadora duplicada')
  await page.getByLabel('Category').selectOption('Kitchen')
  await page.getByLabel('Running watts').fill('1000')
  await page.getByLabel('Surge watts').fill('1000')
  await page.getByLabel('Duty').fill('0.04')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('The id "toaster" is already used by another appliance. Change the English name.')).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('row', { name: /Toaster/ })).toContainText('1000')

  // Switching the edit target without closing the form must show the new target's values, not keep the old draft.
  await page.getByRole('row', { name: /Toaster/ }).getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByLabel('Name (EN)')).toHaveValue('Toaster')
  await page.getByRole('row', { name: /Coffee maker/ }).getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByLabel('Name (EN)')).toHaveValue('Coffee maker')
  await expect(page.getByLabel('Running watts')).toHaveValue('900')
  await page.getByRole('button', { name: 'Cancel' }).click()
})
