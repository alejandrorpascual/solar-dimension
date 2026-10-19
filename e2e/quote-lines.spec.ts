import { expect, test, type Locator } from '@playwright/test'
import { quotesEn } from '../src/i18n/quotes-en'
import { quotesEs } from '../src/i18n/quotes-es'
import { firstProjectId, misreadQuoteCurrency, misreadQuoteLine, stripQuoteOptions } from './db'
import { switchLanguage } from './header'
import { PHONE } from './phone'
import { quotePdf, signUp, uploadQuotes, verdictHeading } from './quotes'

/** The body rows of a card's lines table, each as its cells' text. */
const bodyRows = (lines: Locator) => lines.locator('tbody').getByRole('row')

test('Show checks lists every line read, and a misread card names the check that failed (AI-10)', PHONE, async ({ page }) => {
  // Rewrites the reading three times over Neon's HTTP driver on top of sign-up and an upload.
  test.slow()
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least', { timeout: 30_000 })

  // SolarTec's six lines, each with its quantity, unit price (none is written) and line total.
  const best = page.getByRole('region', { name: 'SolarTec Caribe' })
  await best.getByRole('button', { name: 'Show checks for SolarTec Caribe', exact: true }).click()
  const bestLines = best.getByRole('table', { name: quotesEn.linesTitle })
  await expect(bodyRows(bestLines)).toHaveCount(6)
  await expect(bodyRows(bestLines).nth(4).getByRole('cell')).toHaveText(['Fusible clase T 225 A, uno por tramo', '2', '—', '$90'])
  const deviceWidth = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(deviceWidth)

  // A reading stored before options existed, waiting for a total, still lists its lines.
  await stripQuoteOptions(email, projectId)
  await page.reload()
  const row = page.getByRole('article').filter({ hasText: 'SolarTec Caribe' })
  const rowLines = row.getByRole('table', { name: quotesEn.linesTitle })
  await row.getByRole('button', { name: 'Show checks for SolarTec Caribe', exact: true }).click()
  await expect(bodyRows(rowLines)).toHaveCount(6)

  // A line its quantity and unit price don't make: the card says so, and the line shows the figures that disagree.
  await misreadQuoteLine(email, projectId, 1)
  await page.reload()
  await expect(row).toContainText(quotesEn.misreadLines)
  await expect(row).not.toContainText(quotesEn.misreadCurrency)
  await row.getByRole('button', { name: 'Show checks for SolarTec Caribe', exact: true }).click()
  await expect(bodyRows(rowLines).first().getByRole('cell')).toHaveText(['Inversor híbrido 12 kW 48 V con cargador 120 A', '1', '$1', '$1,890'])

  // The line put right and the currency unreadable instead: a different sentence, in English and Spanish.
  await misreadQuoteLine(email, projectId, 1890)
  await misreadQuoteCurrency(email, projectId, 'RD$')
  await page.reload()
  await expect(row).toContainText(quotesEn.misreadCurrency)
  await expect(row).not.toContainText(quotesEn.misreadLines)
  await switchLanguage(page, 'Español')
  await expect(row).toContainText(quotesEs.misreadCurrency)
  await row.getByRole('button', { name: 'Ver comprobaciones de SolarTec Caribe', exact: true }).click()
  await expect(bodyRows(row.getByRole('table', { name: quotesEs.linesTitle }))).toHaveCount(6)
})
