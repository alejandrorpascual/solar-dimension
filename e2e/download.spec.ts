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
