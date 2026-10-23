import { expect, test, type Page } from '@playwright/test'
import { slugify } from '../src/lib/catalog-schema'
import { catalogAuthHeader, writeHeaders } from './catalog-token'
import { deleteTestAppliance, firstProjectName, markEmailVerified } from './db'
import { quotePdf, signUp, uploadQuotes } from './quotes'
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

/** Signs in as the run's admin, verified: sign-up never verifies, and the admin check requires it. */
async function signInAsAdmin(page: Page) {
  await signInOrUp(page, ADMIN.email, ADMIN.password)
  await markEmailVerified(ADMIN.email)
  // The session cookie caches the user for 5 minutes; a fresh sign-in picks up email_verified.
  await page.context().clearCookies()
  await signInOrUp(page, ADMIN.email, ADMIN.password)
}

for (const path of ['/admin/appliances', '/admin/quotes']) {
  test(`non-admins get a 404 at ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText('Page not found')).toBeVisible()
    await signInOrUp(page, `e2e-${Date.now()}@example.com`, 'correct-horse-battery')
    await page.goto(path)
    await expect(page.getByText('Page not found')).toBeVisible()
  })
}

test('a quote the model could not read shows on /admin/quotes with its file name, account, project, error and time', async ({ page }) => {
  // Sign-up, an upload and its read, then the admin's sign-in: more than 30 s on a slow CI runner.
  test.slow()
  const owner = await signUp(page)
  // The stub reads only the sample quotes; any other file name fails on both models.
  const unreadable = await quotePdf(`unreadable-${Date.now()}`)
  await uploadQuotes(page, [unreadable])
  const dialog = page.getByRole('dialog', { name: "We've got it from here" })
  await expect(dialog.getByRole('listitem').filter({ hasText: unreadable.name }).getByText("Couldn't read it", { exact: true }))
    .toBeVisible({ timeout: 30_000 })

  const project = await firstProjectName(owner)

  await page.context().clearCookies()
  await signInAsAdmin(page)
  await page.goto('/admin/quotes')
  const row = page.getByRole('row').filter({ hasText: unreadable.name })
  // One cell per column, in the header's order: File, Account, Project, Error, Time. The error joins both models' errors.
  const cells = row.getByRole('cell')
  await expect(cells).toHaveCount(5)
  await expect(cells.nth(0)).toHaveText(unreadable.name)
  await expect(cells.nth(1)).toHaveText(owner)
  await expect(cells.nth(2)).toHaveText(project)
  await expect(cells.nth(3)).toContainText(`No stub fixture matches ${unreadable.name}`)
  await expect(cells.nth(4)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)
})

test('an admin adds an appliance, sees it in the picker, and retires it', async ({ page }) => {
  await signInAsAdmin(page)
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
    await expect(page.getByRole('table', { name: 'Catalog' }).getByRole('row', { name: new RegExp(name) })).toBeVisible()

    await page.goto('/?step=1')
    await expect(page.getByText(name)).toBeVisible()

    await page.goto('/admin/appliances')
    await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Retire' }).click()
    // Retiring is an async mutation that clears the picker's 60 s cache once it lands; wait for the row to flip to
    // "Restore" (confirming the mutation and the client-side refresh both completed) before checking the picker,
    // otherwise this navigation can race the write and read the cache before it clears.
    await expect(page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Restore' })).toBeVisible()
    // Both writes are in the change log, newest first, under the admin's email.
    const logged = page.getByRole('table', { name: 'Recent changes' }).getByRole('row', { name: new RegExp(name) })
    await expect(logged).toHaveCount(2)
    await expect(logged.nth(0)).toContainText('retired: false → true')
    await expect(logged.nth(1)).toContainText('Created')
    await expect(logged.nth(1)).toContainText(ADMIN.email)
    await page.goto('/?step=1')
    await expect(page.getByText(name)).toHaveCount(0)
  } finally {
    // Runs even if an assertion above throws midway, so no run leaves its e2e appliance behind.
    await deleteTestAppliance(id)
  }
})

test('sources sent with a token write read back, show in the admin row, and survive later writes that send none', async ({ page, request }) => {
  const id = `e2e-sourced-${Date.now()}`
  const name = `E2E kettle ${id}`
  const kettle = {
    id, category: 'Kitchen', watts: 1500, surge: 1500, duty: 0.1, tons: null, acType: null,
    labels: { en: { name, note: 'Test item' }, es: { name: `Hervidor ${id}`, note: 'Ítem de prueba' } },
  }
  const nameplate = { source: 'https://example.com/e2e-kettle-nameplate.jpg', asWritten: '220-240V~ 50/60Hz 1500W' }
  const post = async (item: object) => expect((await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [item] })).status()).toBe(200)
  const storedSources = async () => {
    const { items } = await (await request.get('/api/catalog/appliances', { headers: catalogAuthHeader })).json() as { items: Array<{ id: string; sources: unknown }> }
    return items.find((i) => i.id === id)?.sources
  }
  try {
    await post({ ...kettle, sources: { watts: [nameplate] } })
    expect(await storedSources()).toEqual({ watts: [nameplate] })

    await post({ ...kettle, duty: 0.12 })
    expect(await storedSources()).toEqual({ watts: [nameplate] })

    await signInAsAdmin(page)
    await page.goto('/admin/appliances')
    const row = page.getByRole('table', { name: 'Catalog' }).getByRole('row', { name: new RegExp(name) })
    const source = row.getByRole('link', { name: `“${nameplate.asWritten}”` })
    await expect(source).toHaveAttribute('href', nameplate.source)

    // The form has no sources field: its save sends none, so the stored ones stay.
    await row.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Duty').fill('0.15')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(row.getByRole('cell').nth(3)).toContainText('0.15')
    await expect(source).toBeVisible()
    expect(await storedSources()).toEqual({ watts: [nameplate] })
  } finally {
    await deleteTestAppliance(id)
  }
})

test('"New appliance" refuses an id that already belongs to another appliance', async ({ page }) => {
  await signInAsAdmin(page)

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
  // The catalog table's rows only: the change log below may list the same appliances.
  const catalogRow = (name: RegExp) => page.getByRole('table', { name: 'Catalog' }).getByRole('row', { name })
  await expect(catalogRow(/Toaster/)).toContainText('1000')

  // Switching the edit target without closing the form must show the new target's values, not keep the old draft.
  await catalogRow(/Toaster/).getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByLabel('Name (EN)')).toHaveValue('Toaster')
  await catalogRow(/Coffee maker/).getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByLabel('Name (EN)')).toHaveValue('Coffee maker')
  await expect(page.getByLabel('Running watts')).toHaveValue('900')
  await page.getByRole('button', { name: 'Cancel' }).click()
})
