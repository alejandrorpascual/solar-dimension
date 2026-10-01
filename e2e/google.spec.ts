import { expect, test } from '@playwright/test'
import { captureGoogleRedirect, expectOurGoogleRequest } from './google'
import { accountAction } from './header'

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
