import { expect, test, type Page } from '@playwright/test'
import { accountAction } from './header'

const GOOGLE_TEST_CLIENT_ID = 'e2e-google-client-id'

/** Stop the browser at Google's sign-in page and hand back the URL it was sent to. */
async function captureGoogleRedirect(page: Page): Promise<() => URL | null> {
  let captured: URL | null = null
  await page.route('https://accounts.google.com/**', (route) => {
    captured = new URL(route.request().url())
    return route.abort()
  })
  return () => captured
}

function expectOurGoogleRequest(url: URL | null, baseURL: string) {
  expect(url?.searchParams.get('client_id')).toBe(GOOGLE_TEST_CLIENT_ID)
  expect(url?.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google`)
  expect(url?.searchParams.get('prompt')).toBe('select_account')
}

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
