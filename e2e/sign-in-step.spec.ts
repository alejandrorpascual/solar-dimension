import { expect, request, test, type Page } from '@playwright/test'
import { captureGoogleRedirect } from './google'

const PASSWORD = 'correct-horse-battery'

/** Makes an email/password account from a request context of its own, so the page itself stays signed out. */
async function newAccount(): Promise<string> {
  const email = `e2e-step-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const auth = await request.newContext({ baseURL: test.info().project.use.baseURL })
  try {
    const response = await auth.post('/api/auth/sign-up/email', { data: { email, password: PASSWORD, name: email.split('@')[0] } })
    expect(response.ok(), await response.text()).toBe(true)
  } finally {
    await auth.dispose()
  }
  return email
}

/** The two ways to sign in from the kit step while signed out. */
const SIGN_IN_LINKS = [
  { from: 'the account menu', link: (page: Page) => page.getByRole('link', { name: 'Sign in', exact: true }) },
  { from: 'the quotes card', link: (page: Page) => page.getByRole('link', { name: 'Sign in to compare quotes' }) },
]

for (const { from, link } of SIGN_IN_LINKS) {
  test(`signing in with email from ${from} on the kit step comes back to the kit step`, async ({ page }) => {
    const email = await newAccount()
    await page.goto('/?step=4')
    await link(page).click()
    await expect(page).toHaveURL(/\/login\?step=4$/)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
    await expect(page).toHaveURL(/\/\?step=4$/)
    await expect(page.getByRole('heading', { name: /^Kit for / })).toBeVisible()
    // Already signed in, the sign-in page sends you straight back to the step it was given.
    await page.goto('/login?step=4')
    await expect(page).toHaveURL(/\/\?step=4$/)
  })
}

test('Continue with Google from the kit step asks to come back to the kit step', async ({ page }) => {
  await captureGoogleRedirect(page)
  await page.goto('/login?step=4')
  const [social] = await Promise.all([
    page.waitForRequest('**/api/auth/sign-in/social'),
    page.getByRole('button', { name: 'Continue with Google' }).click(),
  ])
  expect(social.postDataJSON()).toMatchObject({ provider: 'google', callbackURL: '/?step=4', errorCallbackURL: '/login?step=4' })
})

// The sign-in page puts its step into the addresses it returns to, so only 1-4 may get through: anything else is step 1.
for (const step of ['9', '//evil.example']) {
  test(`with step=${step} the sign-in page sends Google back to step 1`, async ({ page }) => {
    await captureGoogleRedirect(page)
    await page.goto(`/login?step=${encodeURIComponent(step)}`)
    const [social] = await Promise.all([
      page.waitForRequest('**/api/auth/sign-in/social'),
      page.getByRole('button', { name: 'Continue with Google' }).click(),
    ])
    expect(social.postDataJSON()).toMatchObject({ callbackURL: '/?step=1', errorCallbackURL: '/login?step=1' })
  })
}
