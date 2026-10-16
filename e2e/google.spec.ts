import { expect, test, type Page } from '@playwright/test'
import { firstProjectId } from './db'
import { captureGoogleRedirect, expectOurGoogleRequest } from './google'
import { accountAction } from './header'
import { signUp } from './quotes'

const CONNECT_FAILED = "Couldn't connect Google. Try again."

/**
 * Picks Connect Google from the account menu with the network cut. The menu opens until its item shows (a click before
 * the page hydrates opens nothing), and the item is held off while a save is in flight, so the cut waits for both.
 */
async function connectGoogleOffline(page: Page): Promise<void> {
  const item = page.getByRole('menuitem', { name: 'Connect Google' })
  await expect(async () => {
    if (!(await item.isVisible())) await page.getByRole('button', { name: /^Signed in as / }).click()
    await expect(item).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(item).toBeEnabled()
  await page.context().setOffline(true)
  await item.click()
}

/** An alert right under the page's header: the header row has no room for a sentence on a phone. */
const underHeader = (page: Page) => page.locator('header + [role="alert"]')

test('Continue with Google sends the browser to Google with our callback URL', async ({ page, baseURL }) => {
  const googleUrl = await captureGoogleRedirect(page)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect.poll(googleUrl).not.toBeNull()
  expectOurGoogleRequest(googleUrl(), baseURL!)
})

test('an email that already has a password account is told how to connect Google', async ({ page }) => {
  await page.goto('/login?error=account_not_linked')
  await expect(page.getByRole('alert')).toContainText('already has an account')
})

test('any other Google error asks to try again', async ({ page }) => {
  await page.goto('/login?error=access_denied')
  await expect(page.getByRole('alert')).toContainText("didn't finish")
})

test('a signed-in password user can start connecting Google from the account menu', async ({ page, baseURL }) => {
  const email = `e2e-google-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  const googleUrl = await captureGoogleRedirect(page)
  await accountAction(page, 'Connect Google')
  await expect.poll(googleUrl).not.toBeNull()
  expectOurGoogleRequest(googleUrl(), baseURL!)
})

test('connecting Google from the account menu while offline says so under the header, and works once back online', async ({ page, baseURL }) => {
  await signUp(page, { verified: false })
  await page.goto('/')

  await connectGoogleOffline(page)
  await expect(underHeader(page)).toHaveText(CONNECT_FAILED)

  await page.context().setOffline(false)
  const googleUrl = await captureGoogleRedirect(page)
  await accountAction(page, 'Connect Google')
  await expect.poll(googleUrl).not.toBeNull()
  expectOurGoogleRequest(googleUrl(), baseURL!)
})

test("on a project's quotes page, which also offers Connect Google in the verdict, the menu's failure is said once, under the header", async ({ page }) => {
  // Sign-up and the project's first save over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page, { verified: false })
  await page.goto('/?step=4')
  await expect.poll(() => firstProjectId(email).then(() => true, () => false), { timeout: 15_000 }).toBe(true)
  await page.goto(`/projects/${await firstProjectId(email)}/quotes`)
  await expect(page.getByRole('button', { name: 'Connect Google to upload quotes' })).toBeVisible()

  await connectGoogleOffline(page)

  await expect(underHeader(page)).toHaveText(CONNECT_FAILED)
  await expect(page.getByRole('alert').filter({ hasText: CONNECT_FAILED })).toHaveCount(1)
})
