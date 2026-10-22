import { expect, test, type Page } from '@playwright/test'
import { PHONE } from './phone'
import { hideProjects, renameOpenProject } from './projects'
import { pickQuoteFiles, quotePdf, signUp, signUpWithProject, slowQuotePdf, tray, uploadQuotes } from './quotes'

/** A phone as wide as the app's test device, and the narrowest one: the tray's text wraps there, so it is tallest. */
const PHONE_WIDTHS = [390, 320] as const
const VIEWPORT_HEIGHT = 800
/** A project name at the 60-character limit: "Verdict ready for …" wraps to several lines in the tray's narrow text column. */
const LONG_NAME = 'Condominio Villa Martinique, oficina 3, torre norte, piso 2'

/**
 * Scrolls to the end of the page and names the quotes card's buttons that the tray, fixed over the page, then covers
 * any part of. Read in one go, so the tray cannot change from reading to ready between the scroll and the boxes.
 */
const buttonsUnderTray = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    const trayBox = document.querySelector('.qtray')?.getBoundingClientRect()
    if (!trayBox) throw new Error('The tray is not on the page.')
    return [...document.querySelectorAll('.qcard .qbtn')]
      .filter((button) => {
        const box = button.getBoundingClientRect()
        return box.left < trayBox.right && box.right > trayBox.left && box.top < trayBox.bottom && box.bottom > trayBox.top
      })
      .map((button) => button.textContent?.trim() ?? '')
  })

/** At each phone width, the page ends with the card's buttons clear of the tray. */
async function expectButtonsClear(page: Page, state: string): Promise<void> {
  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
    // The page makes room as the tray's box changes (a resize observer reports it a frame later), so it is read until it settles.
    await expect.poll(() => buttonsUnderTray(page), { message: `${state}, at ${width} px` }).toEqual([])
  }
}

test('on a phone, the tray leaves the quotes card buttons clear while a quote is read and once its verdict is ready', PHONE, async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the tray covers the page only under 1024 px')
  await signUp(page)
  await uploadQuotes(page, [await slowQuotePdf('voltia')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await expect(tray(page)).toBeVisible()

  await expectButtonsClear(page, 'while the quote is read')
  await expect(tray(page).getByRole('link', { name: 'See verdict' })).toBeVisible({ timeout: 30_000 })
  await expectButtonsClear(page, 'once the verdict is ready')
})

test('on a phone, a long project name that wraps the tray taller still leaves the quotes card buttons clear', PHONE, async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the tray covers the page only under 1024 px')
  await signUpWithProject(page)
  await renameOpenProject(page, LONG_NAME)
  await hideProjects(page)
  await pickQuoteFiles(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await expect(tray(page)).toContainText(`Verdict ready for ${LONG_NAME}`, { timeout: 30_000 })

  await expectButtonsClear(page, 'with a long project name')
})
