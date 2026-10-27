import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { slugify } from '../src/lib/catalog-schema'
import { productKey } from '../src/lib/product-schema'
import { catalogAuthHeader, writeHeaders } from './catalog-token'
import { deleteTestAppliance, deleteTestProduct, firstProjectName, markEmailVerified } from './db'
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

for (const path of ['/admin/appliances', '/admin/quotes', '/admin/products']) {
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
  // A kettle is not momentary, so its cycles per hour is null; a source sent for it anyway is stored all the same.
  const strayCycles = { source: 'https://example.com/e2e-kettle-manual.pdf', asWritten: 'Boils about 4 times an hour' }
  const sources = { watts: [nameplate], cyclesPerHour: [strayCycles] }
  const post = async (item: object) => expect((await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [item] })).status()).toBe(200)
  const storedSources = async () => {
    const { items } = await (await request.get('/api/catalog/appliances', { headers: catalogAuthHeader })).json() as { items: Array<{ id: string; sources: unknown }> }
    return items.find((i) => i.id === id)?.sources
  }
  try {
    await post({ ...kettle, sources })
    expect(await storedSources()).toEqual(sources)

    await post({ ...kettle, duty: 0.12 })
    expect(await storedSources()).toEqual(sources)

    await signInAsAdmin(page)
    await page.goto('/admin/appliances')
    const row = page.getByRole('table', { name: 'Catalog' }).getByRole('row', { name: new RegExp(name) })
    const source = row.getByRole('link', { name: `“${nameplate.asWritten}”` })
    await expect(source).toHaveAttribute('href', nameplate.source)
    // The quote takes the list's muted color, not the global link accent, at rest and on hover.
    const sourcesColor = await source.evaluate((a) => getComputedStyle(a.closest('.admin__sources')!).color)
    await expect(source).toHaveCSS('color', sourcesColor)
    await source.hover()
    await expect(source).toHaveCSS('color', sourcesColor)
    // Shown whatever the kind, so a source stored against a figure the item does not use can be seen and cleared.
    const kindCell = row.getByRole('cell').nth(4)
    await expect(kindCell).toContainText(`Cycles: “${strayCycles.asWritten}”`)
    await expect(kindCell.getByRole('link', { name: `“${strayCycles.asWritten}”` })).toHaveAttribute('href', strayCycles.source)

    // The form has no sources field: its save sends none, so the stored ones stay.
    await row.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Duty').fill('0.15')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(row.getByRole('cell').nth(3)).toContainText('0.15')
    await expect(source).toBeVisible()
    expect(await storedSources()).toEqual(sources)
  } finally {
    await deleteTestAppliance(id)
  }
})

test('a momentary row shows each figure\'s sources in that figure\'s own cell', async ({ page, request }) => {
  const id = `e2e-sourced-gate-${Date.now()}`
  const name = `E2E gate motor ${id}`
  const sourceFor = (figure: string) => ({ source: `https://example.com/e2e-gate-${figure}.pdf`, asWritten: `Gate motor ${figure} as written` })
  // Surge has two, as the research skill asks for when there is no datasheet: every one of a figure's sources shows.
  const sources = {
    watts: [sourceFor('watts')], surge: [sourceFor('surge'), sourceFor('surge-shop')], duty: [sourceFor('duty')],
    burstSeconds: [sourceFor('burst')], cyclesPerHour: [sourceFor('cycles')],
  }
  // The seed's sliding gate motor figures, so the row is a valid momentary load with a burst and cycles to show.
  const motor = {
    id, category: 'Security', watts: 550, surge: 1650, duty: 0.033, tons: null, acType: null,
    kind: 'momentary', surgeClass: 'motor', burstSeconds: 20, cyclesPerHour: 6,
    labels: { en: { name, note: 'Test item' }, es: { name: `Motor ${id}`, note: 'Ítem de prueba' } },
    sources,
  }
  try {
    expect((await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [motor] })).status()).toBe(200)

    await signInAsAdmin(page)
    await page.goto('/admin/appliances')
    const cells = page.getByRole('table', { name: 'Catalog' }).getByRole('row', { name: new RegExp(name) }).getByRole('cell')
    // Exactly the figure's own links in its cell: a source dropped from a cell, or shown in another, fails here.
    const expectLinks = async (cell: number, list: ReadonlyArray<{ source: string; asWritten: string }>) => {
      await expect(cells.nth(cell).getByRole('link')).toHaveCount(list.length)
      for (const s of list) await expect(cells.nth(cell).getByRole('link', { name: `“${s.asWritten}”`, exact: true })).toHaveAttribute('href', s.source)
    }
    await expectLinks(1, sources.watts)
    await expectLinks(2, sources.surge)
    await expectLinks(3, sources.duty)
    await expectLinks(4, [...sources.burstSeconds, ...sources.cyclesPerHour])
    // Burst and cycles share the Kind cell, so each one is named.
    await expect(cells.nth(4)).toContainText(`Burst: “${sources.burstSeconds[0]!.asWritten}”`)
    await expect(cells.nth(4)).toContainText(`Cycles: “${sources.cyclesPerHour[0]!.asWritten}”`)
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

const SHEET = 'https://example.com/e2e-datasheet.pdf'
const NONE = { value: null, source: null, asWritten: null }
const BRAND = 'E2E Power'

/** A token-written inverter `model`, whose charger reading is `chargerA`; any other field given is sent as well. */
const inverterProduct = (model: string, chargerA: object = NONE, extra: object = {}) => ({
  kind: 'inverter', brand: BRAND, model, makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
  specs: {
    continuousW: { value: 6000, source: SHEET, asWritten: 'Rated power 6000W' }, surges: [], batteryVolts: { value: 48, source: SHEET, asWritten: '48 VDC' },
    splitPhase: NONE, chargerA, pvInputW: NONE, pvVocMax: NONE, maxParallelUnits: NONE, idleW: NONE, peakEfficiencyPct: NONE,
    warrantyYears: NONE, bmsComms: [], compatibleBatteryBrands: [],
  },
  ...extra,
})
const CHARGER_125 = { value: 125, source: SHEET, asWritten: 'Max charge 125A' }
const productKeyOf = (model: string) => productKey({ kind: 'inverter', brand: BRAND, model })
const tokenWrite = (request: APIRequestContext, body: unknown) => request.post('/api/catalog/products', { headers: writeHeaders(), data: [body] })
/** The product's `verification` as the token API's GET shows it. */
async function tokenVerificationOf(request: APIRequestContext, key: string): Promise<unknown> {
  const items = (await (await request.get('/api/catalog/products', { headers: catalogAuthHeader })).json()).items as Array<{ key: string; verification: unknown }>
  return items.find((i) => i.key === key)?.verification
}
const productRow = (page: Page, model: string) => page.getByRole('table', { name: 'Products' }).getByRole('row', { name: new RegExp(model) })

test('a token-written product is unverified until the admin verifies it, and a token edit that changes a value undoes it', async ({ page, request }) => {
  const model = `V${Date.now()}`
  const key = productKeyOf(model)
  try {
    expect((await tokenWrite(request, inverterProduct(model))).status()).toBe(200)
    expect(await tokenVerificationOf(request, key)).toEqual({ status: 'unverified' })

    await signInAsAdmin(page)
    await page.goto('/admin/products')
    const row = productRow(page, model)
    await expect(row).toContainText('Unverified')
    await row.getByRole('button', { name: `Verify ${BRAND} ${model}` }).click()
    await expect(row).toContainText(`Verified${ADMIN.email}`)
    await expect(row.getByRole('button')).toHaveCount(0)

    expect((await tokenWrite(request, inverterProduct(model, CHARGER_125))).status()).toBe(200)
    expect(await tokenVerificationOf(request, key)).toEqual({ status: 'unverified' })
  } finally {
    await deleteTestProduct(key)
  }
})

test('a token write that changes nothing keeps a product verified, and the token cannot verify one itself', async ({ page, request }) => {
  const model = `K${Date.now()}`
  const key = productKeyOf(model)
  try {
    expect((await tokenWrite(request, inverterProduct(model))).status()).toBe(200)
    const claimed = { status: 'verified', by: 'catalog-api', at: '2026-10-25T00:00:00.000Z' }
    for (const extra of [{ verification: claimed }, { verifiedAt: claimed.at }, { verifiedBy: claimed.by }]) {
      expect((await tokenWrite(request, inverterProduct(model, CHARGER_125, extra))).status()).toBe(422)
    }
    expect(await tokenVerificationOf(request, key)).toEqual({ status: 'unverified' })

    await signInAsAdmin(page)
    await page.goto('/admin/products')
    await productRow(page, model).getByRole('button', { name: `Verify ${BRAND} ${model}` }).click()
    await expect(productRow(page, model)).toContainText(`Verified${ADMIN.email}`)

    expect(await (await tokenWrite(request, inverterProduct(model))).json()).toMatchObject({ unchanged: [key] })
    expect(await tokenVerificationOf(request, key)).toMatchObject({ status: 'verified' })
  } finally {
    await deleteTestProduct(key)
  }
})

test('verifying from a page loaded before a token edit says to reload and leaves the product unverified', async ({ page, request }) => {
  const model = `S${Date.now()}`
  const key = productKeyOf(model)
  try {
    expect((await tokenWrite(request, inverterProduct(model))).status()).toBe(200)
    await signInAsAdmin(page)
    await page.goto('/admin/products')
    const row = productRow(page, model)
    await expect(row).toContainText('Unverified')

    expect((await tokenWrite(request, inverterProduct(model, CHARGER_125))).status()).toBe(200)
    await row.getByRole('button', { name: `Verify ${BRAND} ${model}` }).click()

    await expect(page.getByRole('alert')).toContainText('changed since this page loaded')
    await expect(row).toContainText('Unverified')
    expect(await tokenVerificationOf(request, key)).toEqual({ status: 'unverified' })
  } finally {
    await deleteTestProduct(key)
  }
})

test('a token change shows in the admin log, and Revert puts a saved project\'s kit back to the earlier numbers', async ({ page, request, browser }) => {
  const id = `e2e-revert-${Date.now()}`
  const name = `E2E heater ${id}`
  const heater = {
    id, category: 'Kitchen', watts: 400, surge: 400, duty: 1, tons: null, acType: null,
    labels: { en: { name, note: 'Test item' }, es: { name: `Calentador ${id}`, note: 'Ítem de prueba' } },
  }
  const post = async (item: object) => expect((await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [item] })).status()).toBe(200)
  // A project saved in another browser, with one heater on it and nothing else, so its running load is the heater's watts.
  const kitContext = await browser.newContext()
  try {
    await post(heater)
    await post({ ...heater, watts: 800, surge: 800 })

    const kit = await kitContext.newPage()
    await kit.addInitScript(({ key, applianceId }) => {
      if (localStorage.getItem(key)) return
      const project = { id: 'p1', name: 'Heater', qty: { [applianceId]: 1 }, custom: [], hours: 4, volts: 24, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1, dutyOverrides: {} }
      localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
    }, { key: 'solar-dimension.projects.v1', applianceId: id })
    await kit.goto('/?step=4')
    const runningLoad = kit.locator('.stat').filter({ hasText: 'Running load' }).locator('.stat__v')
    await expect(runningLoad).toHaveText('800 W')

    await signInAsAdmin(page)
    await page.goto('/admin/appliances')
    const logged = page.getByRole('table', { name: 'Recent changes' }).getByRole('row', { name: new RegExp(id) })
    await expect(logged).toHaveCount(2)
    await expect(logged.nth(0)).toContainText('watts: 400 → 800')
    await expect(logged.nth(0)).toContainText('api-token')
    // A creation has nothing before it to put back.
    await expect(logged.nth(1).getByRole('button', { name: 'Revert' })).toHaveCount(0)

    // The whole row goes back, so the button says a revert also undoes any later change.
    await expect(logged.nth(0).getByRole('button', { name: 'Revert' })).toHaveAccessibleDescription(/whole row back/)
    await logged.nth(0).getByRole('button', { name: 'Revert' }).click()
    // The revert is its own entry, under the admin, so it can be reverted in turn.
    await expect(logged).toHaveCount(3)
    await expect(logged.nth(0)).toContainText('watts: 800 → 400')
    await expect(logged.nth(0)).toContainText(ADMIN.email)
    await expect(page.getByRole('table', { name: 'Catalog' }).getByRole('row', { name: new RegExp(name) }).getByRole('cell').nth(1)).toHaveText('400')

    await kit.reload()
    await expect(runningLoad).toHaveText('400 W')
  } finally {
    await kitContext.close()
    await deleteTestAppliance(id)
  }
})

test('the admin pages fit a phone, a tablet and a desktop: no sideways page scroll, a wide table scrolls in its own box', async ({ page }) => {
  await signInAsAdmin(page)
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/admin/quotes', '/admin/appliances']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0)
    }
    // Still on /admin/appliances: the catalog's own box scrolls, and every button is a full tap target.
    await expect(page.getByRole('table', { name: 'Catalog' }).locator('xpath=..')).toHaveCSS('overflow-x', 'auto')
    for (const name of ['New appliance', 'Edit']) {
      const box = await page.getByRole('button', { name }).first().boundingBox()
      expect(box?.height, `${name} at ${width}px`).toBeGreaterThanOrEqual(44)
    }
  }
})
