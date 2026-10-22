import { expect, test, type Page } from '@playwright/test'
import { firstProjectId, renameQuoteVendor } from './db'
import { openVerdictFromTray, quotePdf, signUp, uploadQuotes, verdictHeading } from './quotes'

/** A vendor name that a 400 px column cuts short and a page-wide card does not. */
const LONG_VENDOR = 'Sol del Valle Instalaciones'
const DESKTOP = { width: 1440, height: 900 }
const PHONE_WIDTH = { width: 375, height: 667 }
/** How far the card's right edge may sit inside the header's. */
const EDGE_SLACK_PX = 24
/** The page's side gutter on a phone (base.css). */
const PHONE_GUTTER_PX = 16

/** Signs up, uploads the sample quotes and opens the verdict once every quote is read. */
async function openVerdict(page: Page, names: string[]): Promise<{ email: string; projectId: string }> {
  const email = await signUp(page)
  await uploadQuotes(page, await Promise.all(names.map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least', { timeout: 30_000 })
  return { email, projectId }
}

async function box(locator: ReturnType<Page['locator']>) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no box')
  return b
}

test('the verdict gives a single quote the width of the page on a desktop and keeps the phone layout (#143)', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  await page.setViewportSize(DESKTOP)
  const { email, projectId } = await openVerdict(page, ['solartec'])
  await renameQuoteVendor(email, projectId, LONG_VENDOR)
  await page.reload()
  await expect(verdictHeading(page)).toContainText(LONG_VENDOR)

  const best = page.getByRole('region', { name: LONG_VENDOR })
  const header = page.locator('header.header')
  const [bestBox, headerBox] = [await box(best), await box(header)]
  const gap = headerBox.x + headerBox.width - (bestBox.x + bestBox.width)
  expect.soft(gap, 'the best card ends at the header edge').toBeGreaterThanOrEqual(0)
  expect.soft(gap, 'the best card ends near the header edge').toBeLessThanOrEqual(EDGE_SLACK_PX)
  const name = best.getByRole('heading', { name: LONG_VENDOR })
  await expect(name).toBeVisible()
  expect.soft(await name.evaluate((el) => el.scrollWidth - el.clientWidth), 'the vendor name is not cut').toBeLessThanOrEqual(0)

  // The same page on a phone: one column the width of the page's gutters, and nothing to scroll sideways.
  await page.setViewportSize(PHONE_WIDTH)
  const phoneBox = await box(best)
  expect(phoneBox.x).toBeCloseTo(PHONE_GUTTER_PX, 0)
  expect(phoneBox.width).toBeCloseTo(PHONE_WIDTH.width - 2 * PHONE_GUTTER_PX, 0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})

test('the verdict keeps the other quotes beside the best one on a desktop (#143)', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await signUp(page)
  await uploadQuotes(page, await Promise.all(['solartec', 'voltia'].map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')

  const best = await box(page.getByRole('region', { name: 'SolarTec Caribe' }))
  const other = page.getByRole('article').filter({ hasText: 'Voltia Instalaciones' })
  await expect(other).toBeVisible()
  const otherBox = await box(other)
  expect(otherBox.x, 'the other quote sits to the right of the best card').toBeGreaterThanOrEqual(best.x + best.width)
})
