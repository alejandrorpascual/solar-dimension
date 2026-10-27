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

// The phone footer's summary used to stay on one line and end in an ellipsis, which cut "start-up power" off.
for (const lang of ['en', 'es']) {
  test(`the step 1 footer summary shows its start-up power label in full at 375 px in ${lang}`, async ({ page, context }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await context.addCookies([{ name: 'lang', value: lang, url: 'http://localhost:3000' }])
    await page.goto('/?step=1')
    const summary = page.locator('footer.footer .footer__summary')
    await expect(summary).toContainText(lang === 'en' ? 'start-up power' : 'potencia de arranque')
    const { clipped, sideways } = await summary.evaluate((el) => ({
      clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }))
    expect(clipped).toBe(false)
    expect(sideways).toBe(false)
    await expect(page.locator('footer.footer').getByRole('button', { name: lang === 'en' ? 'Next: backup window' : /Siguiente/ })).toBeVisible()
  })
}

// The footer's height follows its summary, so the room the page keeps under it must follow too (--footer-h).
const STORAGE_KEY = 'solar-dimension.projects.v1'
const LONG_NAME = 'N'.repeat(60) // PROJECT_NAME_MAX

for (const { title, lang, step, name, patch } of [
  { title: 'step 4 in es with 2 failing checks', lang: 'es', step: 4, name: 'Garita', patch: { qty: { micro: 1 }, hours: 8, batteryUnit: '12-100' } },
  { title: 'step 1 with a 60-character project name', lang: 'en', step: 1, name: LONG_NAME, patch: { qty: {}, hours: 4, batteryUnit: null } },
]) {
  test(`the end of the page stays clear of a footer that wraps, ${title}, at 375 px`, async ({ page, context }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await context.addCookies([{ name: 'lang', value: lang, url: 'http://localhost:3000' }])
    await page.addInitScript(({ key, name, patch }) => {
      if (localStorage.getItem(key)) return
      const project = { id: 'p1', name, custom: [], volts: 12, chemistry: 'agm', updatedAt: 1, ...patch }
      localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
    }, { key: STORAGE_KEY, name, patch })
    await page.goto(`/?step=${step}`)
    const footer = page.locator('footer.footer')
    await expect(footer).toBeVisible()
    // The footer publishes its height once the page hydrates.
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--footer-h'))).not.toBe('')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const { contentEnd, footerTop } = await page.evaluate(() => {
      const last = document.querySelector('.page .legal')!.getBoundingClientRect()
      return { contentEnd: last.bottom, footerTop: document.querySelector('footer.footer')!.getBoundingClientRect().top }
    })
    expect(contentEnd).toBeLessThanOrEqual(footerTop)
  })
}
