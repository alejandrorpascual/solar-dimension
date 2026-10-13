import { expect, test } from '@playwright/test'
import { accountAction } from './header'
import { acceptNewProjectName, hideProjects, showProjects, startNewProject } from './projects'

test('sign up, keep a project across reload and sign-out/sign-in', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'correct-horse-battery'
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  const name = await startNewProject(page)
  await name.fill('Beach house')
  await acceptNewProjectName(page)
  await expect(page.getByRole('button', { name: 'Beach house', exact: true })).toBeVisible()
  await hideProjects(page)
  await page.reload()
  await showProjects(page)
  await expect(page.getByRole('button', { name: 'Beach house', exact: true })).toBeVisible()
  await hideProjects(page)
  await page.goto('/login')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await accountAction(page, 'Sign out')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await showProjects(page)
  await expect(page.getByRole('button', { name: 'Beach house', exact: true })).toBeVisible()
})

test('the account menu holds off sign-out and Google linking while a project save is in flight', async ({ page }) => {
  const email = `e2e-busy-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  const account = page.getByRole('button', { name: `Signed in as ${email}` })
  await expect(account).toBeVisible()
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  // Hold every server-function write so the save below stays in flight until released.
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (route.request().method() === 'POST') await held
    await route.continue()
  })
  await page.getByRole('button', { name: 'Add Chest freezer' }).click()
  await account.click()
  try {
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: 'Connect Google' })).toBeDisabled()
  } finally {
    release()
  }
  await page.keyboard.press('Escape')
  await account.click()
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: 'Connect Google' })).toBeEnabled()
})

test('an edit made while saves fail survives a reload and then reaches the account', async ({ page }) => {
  const email = `e2e-unsent-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const notSaved = page.getByText('Could not save to your account. Changes are kept on this device.')
  const freezerDuty = page.getByLabel('Chest freezer: share of each hour it runs')
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  // Every write fails, as it does with no signal.
  await page.route('**/_serverFn/**', route => (route.request().method() === 'POST' ? route.abort() : route.continue()))
  await page.getByRole('button', { name: 'Add Chest freezer' }).click()
  await expect(notSaved).toBeVisible()
  await page.unroute('**/_serverFn/**')

  await page.reload()

  await expect(freezerDuty).toBeVisible()
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  await expect(notSaved).toBeHidden()
  // With this browser's copy gone, the freezer can only come from the account.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(freezerDuty).toBeVisible()
})

test('an edit the account refuses as older gives way to the newer copy another device saved', async ({ page, browser }) => {
  const email = `e2e-stale-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'correct-horse-battery'
  const TEN_MINUTES_MS = 600_000
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  // A second device on the same account adds a freezer, after this one loaded.
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const second = await other.newPage()
    await second.goto('/login')
    await second.getByLabel('Email').fill(email)
    await second.getByLabel('Password').fill(password)
    await second.getByRole('button', { name: 'Sign in' }).click()
    await expect(second.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
    await expect(second.getByText('Syncing your projects…')).toBeHidden()
    const saved = second.waitForResponse(r => r.url().includes('/_serverFn/') && r.request().method() === 'POST' && r.ok())
    await second.getByRole('button', { name: 'Add Chest freezer' }).click()
    await saved
  } finally {
    await other.close()
  }
  // This device's clock is slow, so its next edit is stamped before the freezer's.
  await page.evaluate(lag => {
    const realNow = Date.now.bind(Date)
    Date.now = () => realNow() - lag
  }, TEN_MINUTES_MS)

  await page.getByRole('button', { name: 'Add 2 ton AC · conventional' }).click()

  await expect(page.getByLabel('Chest freezer: share of each hour it runs')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove one 2 ton AC · conventional' })).toHaveCount(0)
  await expect(page.getByText('Could not save to your account. Changes are kept on this device.')).toBeHidden()
})
