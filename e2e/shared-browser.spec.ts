import { expect, test, type Page, type Response } from '@playwright/test'
import { quotesEn } from '../src/i18n/quotes-en'
import { cloneProject, countQuoteRows, firstProjectId, markEmailVerified, seedFailedQuote } from './db'
import { accountAction } from './header'
import { acceptNewProjectName, hideProjects, showProjects, startNewProject } from './projects'
import { isProjectRead, pickQuoteFiles, quotePdf } from './quotes'

const PASSWORD = 'correct-horse-battery'
const CLIENT_PROJECT = 'Clinica Lopez'
const newEmail = (who: string) => `e2e-shared-${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

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

async function synced(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
}

/** Adds an appliance to the open project and waits until the account has it. */
async function addAndSave(page: Page, appliance: string): Promise<void> {
  const saved = page.waitForResponse(r => r.url().includes('/_serverFn/') && r.request().method() === 'POST' && r.ok())
  await page.getByRole('button', { name: `Add ${appliance}` }).click()
  await saved
}

/** Waits until no save is in flight: Sign out is held off while one is. What never reached the account would be set aside, not removed. */
async function everythingSaved(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Signed in as / }).click()
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** The id of the project open on this browser, which the quotes page's address needs. */
const currentProjectId = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('solar-dimension.projects.v1') ?? '{}') as { currentId?: string }).currentId)

/** Everything the browser stores for this site, as one string. */
const everythingStored = (page: Page) => page.evaluate(() => Object.entries(localStorage).map(([key, value]) => `${key}=${value}`).join('\n'))

/**
 * Bea has an account whose first project holds a freezer. Then Ana uses the same browser: she adds an air conditioner
 * to her own first project and starts a project for a client. (Two accounts whose first projects share an id, as
 * every account's did once, are in src/hooks/useProjectStore.accounts.test.ts: a browser cannot make one any more.)
 */
async function beaThenAnaOnOneBrowser(page: Page): Promise<{ bea: string }> {
  const bea = newEmail('bea')
  await signUp(page, bea)
  await addAndSave(page, 'Chest freezer')
  await accountAction(page, 'Sign out')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await signUp(page, newEmail('ana'))
  await addAndSave(page, '2 ton AC · conventional')
  const name = await startNewProject(page)
  await name.fill(CLIENT_PROJECT)
  await acceptNewProjectName(page)
  await expect(page.getByRole('button', { name: CLIENT_PROJECT, exact: true })).toBeVisible()
  await hideProjects(page)
  await everythingSaved(page)
  return { bea }
}

async function expectNothingOfAna(page: Page): Promise<void> {
  await showProjects(page)
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('button', { name: CLIENT_PROJECT, exact: true })).toHaveCount(0)
  await hideProjects(page)
  expect(await everythingStored(page)).not.toContain(CLIENT_PROJECT)
}

async function expectBeaKeptHerOwn(page: Page, bea: string): Promise<void> {
  await signIn(page, bea)
  await expect(page.getByLabel('Chest freezer: share of each hour it runs')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove one 2 ton AC · conventional' })).toHaveCount(0)
  await expectNothingOfAna(page)
}

test("after a sign-out the next account on this browser sees and receives none of the last one's projects", async ({ page }) => {
  const { bea } = await beaThenAnaOnOneBrowser(page)

  await accountAction(page, 'Sign out')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()

  await expectNothingOfAna(page)
  await expectBeaKeptHerOwn(page, bea)
})

test('a session that ended without a sign-out leaves nothing either', async ({ page }) => {
  const { bea } = await beaThenAnaOnOneBrowser(page)

  await page.context().clearCookies()
  await page.reload()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()

  await expectNothingOfAna(page)
  await expectBeaKeptHerOwn(page, bea)
})

const SAVE_REFUSED = 'Could not save to your account. Changes are kept on this device.'
const BEAS_FREEZER = 'Chest freezer: share of each hour it runs'

/**
 * Signs out as the first thing after a page load. A click that lands before the page hydrates opens no menu, so the
 * menu is opened until its item shows.
 */
async function signOutOnLoad(page: Page): Promise<void> {
  const item = page.getByRole('menuitem', { name: 'Sign out' })
  await expect(async () => {
    if (!(await item.isVisible())) await page.getByRole('button', { name: /^Signed in as / }).click()
    await expect(item).toBeVisible({ timeout: 1000 })
  }).toPass()
  await item.click()
}

/** In another tab of the same browser, Ana signs out and Bea signs in. Ana's tab stays open as it was. */
async function beaSignsInInAnotherTab(page: Page, bea: string): Promise<Page> {
  const beasTab = await page.context().newPage()
  await beasTab.goto('/')
  await signOutOnLoad(beasTab)
  await expect(beasTab.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await signIn(beasTab, bea)
  return beasTab
}

/** Ana's page stays open in one tab while, in another tab of the same browser, she signs out and Bea signs in. */
async function anasTabLeftOpenAfterBeaSignsIn(page: Page): Promise<{ bea: string; beasTab: Page }> {
  const { bea } = await beaThenAnaOnOneBrowser(page)
  return { bea, beasTab: await beaSignsInInAnotherTab(page, bea) }
}

async function expectBeaHasOnlyHerOwn(beasTab: Page, bea: string): Promise<void> {
  await beasTab.reload()
  await synced(beasTab, bea)
  await expect(beasTab.getByLabel(BEAS_FREEZER)).toBeVisible()
  await expect(beasTab.getByRole('button', { name: 'Remove one 2 ton AC · conventional' })).toHaveCount(0)
  await showProjects(beasTab)
  await expect(beasTab.getByRole('article')).toHaveCount(1)
  await expect(beasTab.getByRole('button', { name: CLIENT_PROJECT, exact: true })).toHaveCount(0)
  await hideProjects(beasTab)
}

test("a tab left open for the last account cannot save into the account that signed in after it", async ({ page }) => {
  const { bea, beasTab } = await anasTabLeftOpenAfterBeaSignsIn(page)

  // Ana's tab still shows her client's project, and now sends with Bea's session.
  await page.getByRole('button', { name: 'Add Chest freezer' }).click()

  await expect(page.getByText(SAVE_REFUSED)).toBeVisible()
  await expectBeaHasOnlyHerOwn(beasTab, bea)
})

test("a tab left open for the last account cannot read the projects of the account that signed in after it", async ({ page }) => {
  const { bea, beasTab } = await anasTabLeftOpenAfterBeaSignsIn(page)

  // Opening another project changes none, so nothing is sent; then to the privacy page and back, which starts the
  // kit builder again on a page that still believes it is Ana's.
  await showProjects(page)
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await hideProjects(page)
  await page.getByRole('link', { name: 'Privacy', exact: true }).click()
  await page.getByRole('link', { name: /Solar Dimension/ }).click()

  await expect(page.getByText(SAVE_REFUSED)).toBeVisible()
  await expect(page.getByLabel(BEAS_FREEZER)).toHaveCount(0)
  await expectBeaHasOnlyHerOwn(beasTab, bea)
})

/**
 * Bea, then Ana on the same browser, both allowed to start quote reads, and Bea holds a project under the id of Ana's
 * first one, as every account made before projects took ids of their own held "p1".
 */
async function anaAndBeaShareAProjectId(page: Page): Promise<{ ana: string; bea: string; projectId: string }> {
  const bea = newEmail('bea')
  await signUp(page, bea)
  await markEmailVerified(bea)
  await accountAction(page, 'Sign out')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  const ana = newEmail('ana')
  await signUp(page, ana)
  await markEmailVerified(ana)
  const projectId = await firstProjectId(ana)
  await cloneProject(bea, projectId)
  return { ana, bea, projectId }
}

/**
 * Ana's page loads again on the step that uploads quotes, so it knows she may upload. The button reads "Saving the
 * project…" until the page has loaded her projects, then "Upload quotes", or "Add quotes" once her quotes have loaded.
 */
async function openQuotesStep(page: Page): Promise<void> {
  await page.goto('/?step=4')
  const upload = new RegExp(`^(${quotesEn.cardUpload}|${quotesEn.cardAddMore})$`)
  await expect(page.getByRole('button', { name: upload })).toBeEnabled({ timeout: 15_000 })
}

const isUpload = (r: Response) => r.url().includes('/_serverFn/') && (r.request().headers()['content-type'] ?? '').includes('multipart/form-data')

test("a tab left open for the last account cannot upload a quote into the account that signed in after it", async ({ page }) => {
  const { bea, projectId } = await anaAndBeaShareAProjectId(page)
  await openQuotesStep(page)
  await beaSignsInInAnotherTab(page, bea)

  // Ana's tab still shows her project, and now sends with Bea's session, for a project id Bea holds too.
  const answered = page.waitForResponse(isUpload)
  await pickQuoteFiles(page, [await quotePdf('solartec')])
  const response = await answered

  expect(await countQuoteRows(bea, projectId)).toBe(0)
  // A refusal written for the caller, not an unexpected failure the server logs and hides behind a reference.
  expect(await response.text()).toContain('This page was loaded for another account')
  await expect(page.getByText("Couldn't upload it. Try again.")).toBeVisible()
})

test("a tab left open for the last account cannot read the quotes of the account that signed in after it", async ({ page }) => {
  const { ana, bea, projectId } = await anaAndBeaShareAProjectId(page)
  // Each holds one quote that could not be read, so Ana's page offers her verdict without waiting on a reading.
  await seedFailedQuote(ana, projectId, 'anas-quote.pdf')
  await seedFailedQuote(bea, projectId, 'beas-quote.pdf')
  await openQuotesStep(page)
  // The link shows once Ana's quotes have loaded, which must happen before Bea signs in: after, they are refused.
  const verdictLink = page.getByRole('link', { name: 'See verdict' }).first()
  await expect(verdictLink).toBeVisible()
  await beaSignsInInAnotherTab(page, bea)

  // A move within the page, so it still believes it is Ana's, to the verdict of the project id Bea holds too.
  const read = page.waitForResponse((r) => isProjectRead(r.url()))
  await verdictLink.click()
  await read

  await expect(page.getByRole('heading', { name: 'Something interrupted the kit builder.' })).toBeVisible()
  await expect(page.getByText('beas-quote.pdf')).toHaveCount(0)
})

test("signing out from a project's quotes page, where the kit builder is not open, takes the projects off the browser too", async ({ page }) => {
  await beaThenAnaOnOneBrowser(page)
  await page.goto(`/projects/${await currentProjectId(page)}/quotes`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await signOutOnLoad(page)

  // Nobody is signed in, so the quotes page gives way to the sign-in page; the kit builder never opened.
  await expect(page).toHaveURL(/\/login/)
  expect(await everythingStored(page)).not.toContain(CLIENT_PROJECT)
})

test("signing back in adds no empty first project beside the one the account already has", async ({ page }) => {
  const email = newEmail('solo')
  const freezerDuty = page.getByLabel('Chest freezer: share of each hour it runs')
  // Signed out: a freezer goes into the first project, which every browser starts with under the same id.
  await page.goto('/')
  await expect(async () => {
    // A click that lands before the page hydrates does nothing, so it is tried until the freezer shows.
    if (!(await freezerDuty.isVisible())) await page.getByRole('button', { name: 'Add Chest freezer' }).click()
    await expect(freezerDuty).toBeVisible({ timeout: 1000 })
  }).toPass()
  await signUp(page, email)
  await expect(freezerDuty).toBeVisible()
  await everythingSaved(page)

  await accountAction(page, 'Sign out')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(freezerDuty).toHaveCount(0)
  await signIn(page, email)

  await expect(freezerDuty).toBeVisible()
  await showProjects(page)
  await expect(page.getByRole('article')).toHaveCount(1)
  await hideProjects(page)
})

const SIGN_OUT_FAILED = 'Could not sign out. You are still signed in. Try again.'

test('a sign-out that never reaches the server says so, and the account stays signed in until one does', async ({ page }) => {
  const email = newEmail('offline')
  await signUp(page, email)

  await page.context().setOffline(true)
  await accountAction(page, 'Sign out')

  await expect(page.getByRole('alert').filter({ hasText: SIGN_OUT_FAILED })).toBeVisible()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()

  await page.context().setOffline(false)
  await accountAction(page, 'Sign out')

  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText(SIGN_OUT_FAILED)).toHaveCount(0)
})

test("a sign-out from a project's quotes page that never reaches the server says so there too", async ({ page }) => {
  const email = newEmail('offline-quotes')
  await signUp(page, email)
  await addAndSave(page, 'Chest freezer')
  await page.goto(`/projects/${await currentProjectId(page)}/quotes`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.context().setOffline(true)
  await signOutOnLoad(page)

  await expect(page.getByRole('alert').filter({ hasText: SIGN_OUT_FAILED })).toBeVisible()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await expect(page).toHaveURL(/\/quotes$/)
})
