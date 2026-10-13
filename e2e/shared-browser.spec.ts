import { expect, test, type Page } from '@playwright/test'
import { accountAction } from './header'
import { acceptNewProjectName, hideProjects, showProjects, startNewProject } from './projects'

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

/** Everything the browser stores for this site, as one string. */
const everythingStored = (page: Page) => page.evaluate(() => Object.entries(localStorage).map(([key, value]) => `${key}=${value}`).join('\n'))

/**
 * Bea has an account whose first project holds a freezer. Then Ana uses the same browser: she adds an air conditioner
 * to her own first project, which has the same id as Bea's and a later stamp, and starts a project for a client.
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
