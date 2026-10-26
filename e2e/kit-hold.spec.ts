import { expect, test, type Locator, type Page } from '@playwright/test'
import { firstProjectId, setProjectQty } from './db'
import { switchLanguage } from './header'
import { openProjectCard, showProjects } from './projects'
import { quotePdf, signUp, tray, uploadQuotes, verdictHeading } from './quotes'

/** Where this spec's screenshots go when SHOTS_DIR is set (QA evidence); unset in CI, so nothing is written. */
const SHOTS_DIR = process.env.SHOTS_DIR

/** The viewports QA evidence is taken at. */
const SHOT_VIEWPORTS = { desktop: { width: 1920, height: 1080 }, tablet: { width: 1024, height: 768 }, mobile: { width: 375, height: 667 } }

/** Screenshots the page at each evidence viewport and, when given and visible, one part of it, under SHOTS_DIR. */
async function shot(page: Page, name: string, part?: Locator): Promise<void> {
  if (!SHOTS_DIR) return
  const before = page.viewportSize()
  for (const [label, size] of Object.entries(SHOT_VIEWPORTS)) {
    await page.setViewportSize(size)
    if (part && (await part.isVisible())) await part.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS_DIR}/${name}-${label}.png` })
    if (part && label !== 'mobile' && (await part.isVisible())) await part.screenshot({ path: `${SHOTS_DIR}/${name}-${label}-crop.png` })
  }
  if (before) await page.setViewportSize(before)
}

/** One finished quote on the account's project, read but not yet opened: a whole kit would show "Verdict ready". */
async function projectWithReadQuote(page: Page): Promise<{ email: string; projectId: string }> {
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await expect(tray(page).getByRole('link', { name: 'See verdict' })).toBeVisible({ timeout: 30_000 })
  return { email, projectId: await firstProjectId(email) }
}

/** Reloads with the browser's copy of the projects gone, so the page shows the kit the server holds. */
async function reloadFromServer(page: Page, path: string): Promise<void> {
  await page.evaluate(() => localStorage.clear())
  await page.goto(path)
}

const quotesCard = (page: Page) => page.locator('.qcard')
const cardQuoteLine = (page: Page) => openProjectCard(page).locator('.pcard__quotes')

test('a kit missing an appliance holds the cards and the quotes page, in English and Spanish (#204)', async ({ page }) => {
  // Sign-up, a quote read and database writes over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const { email, projectId } = await projectWithReadQuote(page)
  // The kit still counts 3 of a custom appliance that no longer loads.
  await setProjectQty(email, projectId, { fridge: 1, lights: 1, router: 1, tv: 1, custom1: 3 })
  await reloadFromServer(page, '/?step=4')

  await expect(page.getByText('1 appliance in this project could not be loaded, so this kit leaves it out.', { exact: false })).toBeVisible()
  await expect(quotesCard(page).getByRole('heading', { level: 3 })).toHaveText('Your kit is missing appliances', { timeout: 15_000 })
  await showProjects(page)
  await expect(cardQuoteLine(page)).toHaveText('Your kit is missing appliances')
  await expect(page.getByText('Verdict ready')).toHaveCount(0)
  await expect(tray(page)).toBeHidden()
  await shot(page, 'ac2-missing-en', quotesCard(page))

  await switchLanguage(page, 'Español')
  await expect(quotesCard(page).getByRole('heading', { level: 3 })).toHaveText('A tu kit le faltan aparatos')
  await expect(cardQuoteLine(page)).toHaveText('A tu kit le faltan aparatos')
  await shot(page, 'ac2-missing-es', quotesCard(page))
  await switchLanguage(page, 'English')

  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('Your kit is missing appliances')
  await expect(page.getByRole('region', { name: 'SolarTec Caribe' })).toHaveCount(0)
  await shot(page, 'ac1-missing-quotes-page')
})

test('an empty kit still asks for appliances on the cards and the quotes page (#204)', async ({ page }) => {
  test.slow()
  const { email, projectId } = await projectWithReadQuote(page)
  await setProjectQty(email, projectId, {})
  await reloadFromServer(page, '/')

  await showProjects(page)
  await expect(cardQuoteLine(page)).toHaveText('Add appliances to compare your quotes', { timeout: 15_000 })
  await expect(page.getByText('Verdict ready')).toHaveCount(0)
  await shot(page, 'ac3-empty-cards', openProjectCard(page))

  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('Add appliances to compare your quotes')
  await shot(page, 'ac3-empty-quotes-page')
})
