import { expect, test, type Page } from '@playwright/test'

/** Each step's level-1 heading for the Home project, in English. */
const HEADINGS = {
  1: 'Which appliances need to stay on?',
  2: 'How long should the backup last?',
  3: 'Do you have roof space for panels?',
  4: 'Kit for Home',
} as const

/** The page has one level-1 heading, it reads `name`, and it holds focus, so a screen reader announces the step. */
async function expectStepFocused(page: Page, name: string): Promise<void> {
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveCount(1)
  await expect(heading).toHaveText(name)
  await expect(heading).toBeFocused()
}

/** A click that lands before the page hydrates does nothing: click until the URL shows `step`, never twice. */
async function clickToStep(page: Page, button: string, step: number): Promise<void> {
  const url = new RegExp(`step=${step}`)
  await expect(async () => {
    if (!url.test(page.url())) await page.getByRole('button', { name: button, exact: true }).click()
    await expect(page).toHaveURL(url, { timeout: 1000 })
  }).toPass()
}

test('Next and Back put focus on the new step heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: HEADINGS[1] })).toBeVisible()
  await clickToStep(page, 'Next: backup window', 2)
  await expectStepFocused(page, HEADINGS[2])
  await page.getByRole('button', { name: 'Next: solar panels' }).click()
  await expectStepFocused(page, HEADINGS[3])
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expectStepFocused(page, HEADINGS[4])
  await page.getByRole('button', { name: 'Step 3: Solar panels' }).click()
  await expectStepFocused(page, HEADINGS[3])
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expectStepFocused(page, HEADINGS[2])
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expectStepFocused(page, HEADINGS[1])
})

test('a stepper click puts focus on the new step heading, on every step', async ({ page }) => {
  await page.goto('/?step=2')
  await expect(page.getByRole('heading', { level: 1, name: HEADINGS[2] })).toBeVisible()
  await clickToStep(page, 'Step 4: Your kit', 4)
  await expectStepFocused(page, HEADINGS[4])
  for (const step of [1, 3, 2] as const) {
    const label = { 1: 'Step 1: Appliances', 2: 'Step 2: Backup window', 3: 'Step 3: Solar panels' }[step]
    await page.getByRole('button', { name: label }).click()
    await expectStepFocused(page, HEADINGS[step])
  }
})

test('the sign-in page has one level-1 heading', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
})
