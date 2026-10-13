import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { RETRY_AFTER_MS, showDownload } from './projects'

/** The default 48 V kit on 12 V 100 Ah units: eight batteries, four in series on each of two strings. */
async function buildSeriesParallelKit(page: Page): Promise<void> {
  await page.goto('/?step=4')
  const sizes = page.getByRole('listbox')
  // The battery picker ignores a click that lands before hydration.
  await expect(async () => {
    if (!(await sizes.isVisible())) await page.getByRole('button', { name: /Battery size/ }).click()
    await expect(sizes).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
  await sizes.getByRole('group', { name: /^12 V batteries/ }).getByRole('option', { name: /^100 Ah/ }).click()
  await expect(sizes).toBeHidden()
}

const partRow = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) })

const pdfPageCount = async (file: Download) =>
  (await readFile((await file.path())!)).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0

test('a bank in series and in parallel lists its links and its string leads, each at the gauge of one string', async ({ page }) => {
  await buildSeriesParallelKit(page)
  await expect(partRow(page, 'Batteries')).toContainText('×8')
  await expect(partRow(page, 'Main cable')).toContainText('2 AWG')
  const links = partRow(page, 'Interconnects')
  await expect(links).toContainText('6 AWG jumpers, 30 cm each')
  await expect(links).toContainText('×6')
  const leads = partRow(page, 'String leads')
  await expect(leads).toContainText('6 AWG (13.3 mm²) copper, 30 cm each')
  await expect(leads).toContainText('bus bars not listed')
  await expect(leads).toContainText('×4')
  await expect(partRow(page, 'String fuses')).toContainText('×2')
})

test('with both bank-wiring rows the spec sheet still prints on two pages, and the CSV carries the rows', async ({ page }) => {
  await buildSeriesParallelKit(page)
  await showDownload(page)
  const sheet = page.locator('.ksheet').filter({ visible: true })
  await expect(sheet.getByText('Interconnects', { exact: true })).toBeVisible()
  await expect(sheet.getByText('String leads', { exact: true })).toBeVisible()
  // Page one holds the parts list and page two the load schedule: a parts list pushed off page one would make three.
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  expect(await pdfPageCount(pdf)).toBe(2)

  await page.getByRole('radio', { name: /^Parts list \(CSV\)/ }).check()
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  const text = await readFile((await csv.path())!, 'utf8')
  expect(text).toContain('Interconnects,"6 AWG jumpers, 30 cm each",')
  expect(text).toContain('String leads,"6 AWG (13.3 mm²) copper, 30 cm each",')
})
