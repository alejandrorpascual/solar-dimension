// One account open in two tabs of one browser, or in two browsers: an edit made in one is not undone by the next edit
// made in the other (issue #93). The account is read back from the database, not from the page.
import { expect, test, type Page, type Request, type Route } from '@playwright/test'
import { savedProject } from './db'

const PASSWORD = 'e2e-sync-password-1234'
const newEmail = () => `e2e-sync-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const hoursShown = (page: Page) => page.locator('.hours-value')
const voltage = (page: Page, volts: number) => page.getByRole('main').getByRole('button', { name: new RegExp(`^${volts} V`) })

async function synced(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await synced(page, email)
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await synced(page, email)
}

/** Opens step 2 (hours and battery) once the account's projects are in. */
async function openStep2(page: Page, email: string): Promise<void> {
  await page.goto('/?step=2')
  await synced(page, email)
}

const isSave = (request: Request) => request.url().includes('/_serverFn/') && request.method() === 'POST'

/** Clicks `target` and waits until the save it starts is answered. */
async function clickAndSave(page: Page, target: ReturnType<Page['getByRole']>): Promise<void> {
  const saved = page.waitForResponse((r) => isSave(r.request()) && r.ok())
  await target.click()
  await saved
}

/**
 * The user comes back to this window. Headless Chromium fires no focus event when a page is brought to the front (every
 * page reads as visible and focused), so the event a real window gets is dispatched here; the page then reads the
 * account, and this waits for that read.
 */
async function comeBack(page: Page): Promise<void> {
  const read = page.waitForResponse((r) => r.url().includes('/_serverFn/') && r.request().method() === 'GET' && r.ok())
  await page.bringToFront()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await read
}

test('two tabs: hours set in tab A show in tab B, volts set in B next keep them, in the account and after a reload', async ({ page: tabA }) => {
  const email = newEmail()
  await signUp(tabA, email)
  await openStep2(tabA, email)
  const tabB = await tabA.context().newPage()
  await openStep2(tabB, email)

  await clickAndSave(tabA, tabA.getByRole('button', { name: '24 h', exact: true }))
  await expect(hoursShown(tabB)).toHaveText('24 h')
  await tabB.bringToFront()
  await clickAndSave(tabB, voltage(tabB, 12))

  await expect.poll(() => savedProject(email, 'Home')).toMatchObject({ hours: 24, volts: 12 })
  for (const tab of [tabA, tabB]) {
    await tab.reload()
    await synced(tab, email)
    await expect(hoursShown(tab)).toHaveText('24 h')
    await expect(voltage(tab, 12)).toHaveAttribute('aria-pressed', 'true')
  }
})

test("two browsers: B shows A's saved hours once it is back, and volts set in B next keep them", async ({ page: deviceA, browser }) => {
  const email = newEmail()
  await signUp(deviceA, email)
  await openStep2(deviceA, email)
  const otherBrowser = await browser.newContext()
  const deviceB = await otherBrowser.newPage()
  await signIn(deviceB, email)
  await openStep2(deviceB, email)

  await clickAndSave(deviceA, deviceA.getByRole('button', { name: '24 h', exact: true }))
  await expect(hoursShown(deviceB)).toHaveText('10 h')
  await comeBack(deviceB)
  await expect(hoursShown(deviceB)).toHaveText('24 h')
  await clickAndSave(deviceB, voltage(deviceB, 12))

  await expect.poll(() => savedProject(email, 'Home')).toMatchObject({ hours: 24, volts: 12 })
  await comeBack(deviceA)
  await expect(voltage(deviceA, 12)).toHaveAttribute('aria-pressed', 'true')
  await expect(hoursShown(deviceA)).toHaveText('24 h')
  await otherBrowser.close()
})

/** A seroval object node of the request body: its keys and their values side by side. */
type Node = { t?: number; p?: { k: string[]; v: unknown[] }; a?: unknown[] }

/**
 * Takes `field` out of every object in a save's body that has it beside `besideKey`: by default every project (they
 * carry `hours`), as a build older than that field sends it. Returns how many it took out of.
 */
function stripField(node: unknown, field: string, besideKey: string | null = 'hours'): number {
  if (!node || typeof node !== 'object') return 0
  const n = node as Node
  let stripped = 0
  if (n.p && Array.isArray(n.p.k) && (besideKey === null || n.p.k.includes(besideKey)) && n.p.k.includes(field)) {
    const at = n.p.k.indexOf(field)
    n.p.k.splice(at, 1)
    n.p.v.splice(at, 1)
    stripped += 1
  }
  for (const child of Object.values(n)) stripped += stripField(child, field, besideKey)
  return stripped
}

test('a save whose project has no solar field leaves the stored solar settings unchanged', async ({ page }) => {
  const email = newEmail()
  await signUp(page, email)
  await page.goto('/?step=3')
  await synced(page, email)
  await clickAndSave(page, page.getByRole('button', { name: /^Yes, add panels/ }))
  await expect.poll(async () => (await savedProject(email, 'Home'))?.solar).not.toBeNull()
  const solarBefore = (await savedProject(email, 'Home'))!.solar

  let strippedProjects = 0
  let strippedNames = 0
  await page.route('**/_serverFn/**', async (route: Route) => {
    const request = route.request()
    if (!isSave(request)) return route.continue()
    const body = JSON.parse(request.postData() ?? 'null') as unknown
    strippedProjects += stripField(body, 'solar')
    // A build older than solar also names no fields, so the account writes whole projects, as it did then.
    strippedNames += stripField(body, 'named', null)
    return route.continue({ postData: JSON.stringify(body) })
  })
  await page.goto('/?step=2')
  await synced(page, email)
  await clickAndSave(page, page.getByRole('button', { name: '24 h', exact: true }))

  expect(strippedProjects).toBeGreaterThan(0)
  expect(strippedNames).toBeGreaterThan(0)
  await expect.poll(async () => {
    const saved = await savedProject(email, 'Home')
    return { hours: saved?.hours, solar: saved?.solar }
  }).toEqual({ hours: 24, solar: solarBefore })
})
