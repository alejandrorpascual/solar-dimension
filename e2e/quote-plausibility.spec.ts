import { expect, test } from '@playwright/test'
import { quotesEn } from '../src/i18n/quotes-en'
import { firstProjectId, misreadQuoteSpec, quoteRetryStates, setQuoteRetries, setQuoteTotalOverride } from './db'
import { quotePdf, quotePdfOfPages, signUp, uploadQuotes, verdictHeading } from './quotes'

/** SolarTec's battery line in SAMPLE_QUOTES (src/lib/quote-fixtures.ts): 8 batteries of 5.12 kWh. */
const SOLARTEC_BATTERY_LINE = 1
/** SolarTec's total, which the user types on its card. */
const SOLARTEC_TOTAL = 6480

test('a reading that cites a page past the end of its file shows the misread card, read again or not', async ({ page }) => {
  const email = await signUp(page)
  // The SolarTec reading cites page 2, which a one-page file does not have.
  await uploadQuotes(page, [await quotePdfOfPages('solartec', 1)])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  const row = page.getByRole('article').filter({ hasText: 'SolarTec Caribe' })
  await expect(row).toContainText(quotesEn.implausibleHelp, { timeout: 30_000 })
  await expect(verdictHeading(page)).toHaveText(quotesEn.headingNone)
  await expect(row.getByRole('textbox')).toHaveCount(0)
  expect(await quoteRetryStates(email, projectId)).toEqual([{ status: 'needs_review', retries: 0 }])

  // Read again, it reads the same: a reading read again takes a typed total, but not an implausible one.
  await row.getByRole('button', { name: quotesEn.readAgain }).click()
  await expect.poll(() => quoteRetryStates(email, projectId), { timeout: 30_000 }).toEqual([{ status: 'needs_review', retries: 1 }])
  await page.reload()
  await expect(row).toContainText(quotesEn.implausibleHelp)
  await expect(row.getByRole('textbox')).toHaveCount(0)
  await expect(verdictHeading(page)).toHaveText(quotesEn.headingNone)
})

test('a 5,120 kWh battery shows the misread card: a typed total does not rank it, read again or not', async ({ page }) => {
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least', { timeout: 30_000 })

  // Wh read as kWh, with the right total typed on the card.
  await misreadQuoteSpec(email, projectId, SOLARTEC_BATTERY_LINE, 'kWh', 5120)
  await setQuoteTotalOverride(email, projectId, SOLARTEC_TOTAL)
  const row = page.getByRole('article').filter({ hasText: 'SolarTec Caribe' })
  for (const retries of [0, 1]) {
    await setQuoteRetries(email, projectId, retries)
    await page.reload()
    await expect(verdictHeading(page), `${retries} read again`).toHaveText(quotesEn.headingNone)
    await expect(row, `${retries} read again`).toContainText(quotesEn.implausibleHelp)
    await expect(row.getByRole('textbox'), `${retries} read again`).toHaveCount(0)
  }
})
