import { expect, test, type Page } from '@playwright/test'
import { OWNER_KEY, STORAGE_KEY } from '../src/lib/persistence'
import { openProjectTitle, renameOpenProject, RETRY_AFTER_MS, showDownload } from './projects'
import { signUp } from './quotes'
import { DOWN_PORT } from './servers'

const DOWN_SERVER = `http://localhost:${DOWN_PORT}`
const ACCOUNT_PROJECT = 'Clinica Lopez'

type StoredCopy = { projects: string | null; owner: string | null }

/** The account's copy as this browser holds it for the page's origin: its projects and whose they are. */
const storedCopy = (page: Page): Promise<StoredCopy> =>
  page.evaluate(([projectsKey, ownerKey]) => ({ projects: localStorage.getItem(projectsKey), owner: localStorage.getItem(ownerKey) }), [STORAGE_KEY, OWNER_KEY])

/** Puts `copy` in this origin's storage: what a browser that synced with the account on this site would hold. */
async function storeCopy(page: Page, copy: StoredCopy): Promise<void> {
  await page.evaluate(([projectsKey, ownerKey, projects, owner]) => {
    localStorage.setItem(projectsKey, projects)
    localStorage.setItem(ownerKey, owner)
  }, [STORAGE_KEY, OWNER_KEY, copy.projects ?? '', copy.owner ?? ''])
}

/** Everything this browser stores for the page's origin. */
const everythingStored = (page: Page): Promise<Record<string, string>> => page.evaluate(() => ({ ...localStorage }))

const unreachableNotice = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Could not reach your account. You can keep building the kit; changes stay on this page only.' })

async function expectBuilderWithNotice(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  await expect(unreachableNotice(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Something interrupted the kit builder.' })).toHaveCount(0)
  // Someone may be signed in: the header offers no Sign in next to a notice that says the account is unreachable.
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0)
}

test('with the database down, a signed-in browser keeps sizing and leaves the account copy it holds as it was', async ({ page }) => {
  // The account's copy, made on the main server: a renamed project and the marker that says whose it is.
  const email = await signUp(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await renameOpenProject(page, ACCOUNT_PROJECT)
  await expect(openProjectTitle(page)).toHaveText(ACCOUNT_PROJECT)
  const copy = await storedCopy(page)
  expect(copy.projects).toContain(ACCOUNT_PROJECT)
  expect(copy.owner).not.toBeNull()

  // The same browser, with the same session cookie, on the server whose database is down.
  await page.goto(`${DOWN_SERVER}/?step=1`)
  await expectBuilderWithNotice(page)
  await storeCopy(page, copy)
  await page.reload()
  await expectBuilderWithNotice(page)
  await expect(page.getByText(ACCOUNT_PROJECT)).toHaveCount(0)

  // An edit works, stays on the page, and the account's copy is not touched by it or by the reload.
  const freezers = page.getByRole('textbox', { name: 'Quantity of Chest freezer' })
  await expect(freezers).toHaveCount(0)
  // A click that lands before the page hydrates does nothing, so it is tried again until the freezer is in.
  await expect(async () => {
    if ((await freezers.count()) === 0) await page.getByRole('button', { name: 'Add Chest freezer' }).click()
    await expect(freezers).toHaveValue('1', { timeout: RETRY_AFTER_MS })
  }).toPass()
  expect(await storedCopy(page)).toEqual(copy)
  await page.reload()
  await expectBuilderWithNotice(page)
  await expect(freezers).toHaveCount(0)
  expect(await storedCopy(page)).toEqual(copy)
})

test('with the database down, client details stay on the page: the browser keeps neither the draft nor the saved client', async ({ page }) => {
  await signUp(page)
  await page.goto(`${DOWN_SERVER}/?step=4`)
  await expect(unreachableNotice(page)).toBeVisible()
  const held = await everythingStored(page)
  await showDownload(page)
  const form = page.getByRole('dialog', { name: 'Client details' })
  const addClient = page.getByRole('button', { name: /^Add client details/ })

  await addClient.click()
  await form.getByLabel('Full name').fill('Ann Lee')
  await expect(form.getByText('Draft saved on this device')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()
  expect(await everythingStored(page)).toEqual(held)

  await addClient.click()
  await expect(form.getByText('Picking up where you left off')).toBeVisible()
  await expect(form.getByRole('checkbox', { name: 'Save to my clients' })).toBeChecked()
  await form.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Change: Ann Lee' }).click()
  const list = page.getByRole('dialog', { name: 'Who is this spec sheet for?' })
  await expect(list.getByRole('radio', { name: /Ann Lee/ })).toBeChecked()
  await expect(list.getByText('Only in this project')).toHaveCount(0)
  expect(await everythingStored(page)).toEqual(held)

  await page.reload()
  await showDownload(page)
  await addClient.click()
  await expect(form.getByLabel('Full name')).toHaveValue('')
  await expect(form.getByText('Picking up where you left off')).toHaveCount(0)
})
