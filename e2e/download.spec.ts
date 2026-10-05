import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { showDownload } from './projects'

async function downloadAs(page: Page, format: RegExp, button: string): Promise<Download> {
  await page.getByRole('radio', { name: format }).check()
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
  return file
}

test('the kit downloads as a CSV parts list and a PDF spec sheet', async ({ page }) => {
  await page.goto('/?step=3')
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await showDownload(page)

  const csv = await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV')
  expect(csv.suggestedFilename()).toBe('Home-kit.csv')
  await expect(page.getByRole('status').filter({ hasText: 'File ready. Download started.' })).toBeVisible()
  const text = await readFile((await csv.path())!, 'utf8')
  expect(text).toContain('Appliance,Quantity,Each (W),Running (W),Wh over 10 h')
  expect(text).toContain('Refrigerator,1,150,150,')
  expect(text).toContain('Part,Specification,Note,Quantity')
  expect(text).not.toContain('Interconnects')

  await expect(page.getByRole('checkbox', { name: 'Summary figures' })).toBeDisabled()
  await page.getByRole('checkbox', { name: 'Appliance list' }).uncheck()
  const partsOnly = await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV')
  expect(await readFile((await partsOnly.path())!, 'utf8')).not.toContain('Refrigerator')

  const pdf = await downloadAs(page, /^Spec sheet \(PDF\)/, 'Download PDF')
  expect(pdf.suggestedFilename()).toBe('Home-kit.pdf')
  const bytes = await readFile((await pdf.path())!)
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('export progress is visible while the file is being prepared', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  // Hold the on-demand PDF library request to observe progress without a timing race.
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route(/jspdf.*\.js/, async route => { await held; await route.continue() })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  try {
    await expect(page.getByRole('progressbar', { name: 'Preparing the file…' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preparing the file…' })).toBeDisabled()
    await expect(page.getByRole('radio').first()).toBeDisabled()
  } finally {
    release()
  }
  await downloaded
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: 'File ready. Download started.' })).toBeVisible()
})

const pdfPageCount = async (file: Download) =>
  (await readFile((await file.path())!)).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0

test('the parts list comes first, and the load schedule gets a PDF page of its own', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const sheet = page.locator('.ksheet').filter({ visible: true })
  await expect(sheet.locator('h3')).toHaveText(['Parts list', 'Load schedule'])
  expect(await pdfPageCount(await downloadAs(page, /^Spec sheet \(PDF\)/, 'Download PDF'))).toBe(2)

  await page.getByRole('checkbox', { name: 'Appliance list' }).uncheck()
  expect(await pdfPageCount(await downloadAs(page, /^Spec sheet \(PDF\)/, 'Download PDF'))).toBe(1)
})

test('the preview opens larger, page by page as the PDF prints, or as one image for PNG', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  await page.getByRole('button', { name: 'View larger' }).click()
  const view = page.getByRole('dialog', { name: 'Preview' })
  await expect(view.getByText('Page 1 of 2')).toBeVisible()
  await expect(view.getByText('Page 2 of 2')).toBeVisible()
  // An A4-shaped page, and big enough to read: at least 70% of the sheet's real size, even on a phone (it scrolls sideways).
  const firstPage = await view.locator('.pvw__page').first().boundingBox()
  expect(firstPage!.height / firstPage!.width).toBeCloseTo(841.89 / 595.28, 1)
  expect(firstPage!.width).toBeGreaterThanOrEqual(555)
  // The pages are pictures of the sheet (hidden from assistive tech); the load schedule sits on page 2.
  await expect(view.locator('.pvw__page').nth(1).getByText('Load schedule')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  await expect(page.getByRole('button', { name: 'View larger' })).toBeFocused()

  await page.getByRole('radio', { name: /^Summary image \(PNG\)/ }).check()
  await page.getByRole('button', { name: 'View larger' }).click()
  await expect(view.getByText('The whole sheet in one image')).toBeVisible()
  await expect(view.getByText(/^Page \d of \d$/)).toHaveCount(0)
})
