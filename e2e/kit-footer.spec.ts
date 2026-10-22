import { expect, test, type Page } from '@playwright/test'
import { PHONE } from './phone'
import { RETRY_AFTER_MS } from './projects'

const footerButton = (page: Page, name: string) => page.locator('footer.footer').getByRole('button', { name, exact: true })
const PRIMARY = /\bbtn--primary\b/

test('on the kit step Download is the footer\'s primary button and Start over a secondary one, at this device\'s width', PHONE, async ({ page }) => {
  await page.goto('/?step=4')
  await expect(footerButton(page, 'Download')).toBeVisible()
  await expect(footerButton(page, 'Download')).toHaveClass(PRIMARY)
  await expect(footerButton(page, 'Start over')).toBeVisible()
  await expect(footerButton(page, 'Start over')).not.toHaveClass(PRIMARY)
})

// 1440 px is the width the ticket names. 1280 px is where the rail starts to show (rail.css), and Download checks the
// same width (RAIL_SHOWN in src/routes/index.tsx) to pick the rail over the sheet; the 1279 px test below is its other side.
for (const width of [1440, 1280]) test.describe(`at ${width} px, where the rail shows beside the page`, () => {
  test.use({ viewport: { width, height: 900 } })

  test('the footer\'s primary Download opens the rail\'s Download tab, and Start over is secondary', async ({ page }) => {
    await page.goto('/?step=4')
    const download = footerButton(page, 'Download')
    await expect(download).toBeVisible()
    await expect(download).toHaveClass(PRIMARY)
    await expect(footerButton(page, 'Start over')).not.toHaveClass(PRIMARY)
    const rail = page.getByRole('complementary', { name: 'Projects' })
    const tab = rail.getByRole('tab', { name: 'Download' })
    await expect(tab).toHaveAttribute('aria-selected', 'false')
    // A click before the page hydrates does nothing: click until the tab is selected.
    await expect(async () => {
      await download.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: RETRY_AFTER_MS })
    }).toPass()
    await expect(tab).toBeFocused()
    await expect(rail.getByRole('button', { name: 'Download PDF' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test.describe('at 1279 px, one below where the rail shows', () => {
  test.use({ viewport: { width: 1279, height: 900 } })

  test('the footer\'s Download opens the download sheet on its Download tab', async ({ page }) => {
    await page.goto('/?step=4')
    await expect(page.getByRole('complementary', { name: 'Projects' })).toBeHidden()
    const sheet = page.getByRole('dialog', { name: 'Download' })
    // A click before the page hydrates does nothing: click until the sheet opens. Once open, it covers the button.
    await expect(async () => {
      if (!(await sheet.isVisible())) await footerButton(page, 'Download').click()
      await expect(sheet).toBeVisible({ timeout: RETRY_AFTER_MS })
    }).toPass()
    await expect(sheet.getByRole('tab', { name: 'Download' })).toHaveAttribute('aria-selected', 'true')
  })
})

test('the Cable run summary on step 2 shows a chevron', PHONE, async ({ page }) => {
  await page.goto('/?step=2')
  await expect(page.locator('summary', { hasText: 'Cable run' }).locator('svg.elec__chev')).toBeVisible()
})
