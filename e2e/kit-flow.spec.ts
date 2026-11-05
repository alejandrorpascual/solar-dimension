import { expect, test } from '@playwright/test'
import { PHONE } from './phone'
import { RETRY_AFTER_MS, showDownload } from './projects'

const WIDE = { width: 1440, height: 900 }
const PHONE_SCREEN = { width: 390, height: 844 }

test('a first visit says the list is an example, and Clear all starts an empty one', PHONE, async ({ page }) => {
  await page.goto('/')
  const note = page.locator('.toolbar__note')
  await expect(note).toContainText('An example list to start from.')
  const next = page.getByRole('button', { name: 'Next: backup window' })
  await expect(next).toBeEnabled()
  await expect(async () => {
    await note.getByRole('button', { name: 'Clear all' }).click({ timeout: RETRY_AFTER_MS })
    await expect(note).toContainText('Add each one and set how many.', { timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(note.getByRole('button')).toHaveCount(0)
  await expect(note).toBeFocused()
  await expect(next).toBeDisabled()
})

test('on a phone at least one whole added card shows above the footer on the first screen', PHONE, async ({ page }) => {
  await page.setViewportSize(PHONE_SCREEN)
  await page.goto('/')
  const card = await page.locator('.card--on').first().boundingBox()
  const footer = await page.locator('footer.footer').boundingBox()
  expect(card!.y + card!.height).toBeLessThanOrEqual(footer!.y)
})

for (const viewport of [WIDE, { width: 1100, height: 800 }]) {
  test(`at ${viewport.width} px Next stays on screen from the top of a long step`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Next: backup window' })).toBeInViewport({ ratio: 1 })
  })
}

test('Add moves focus to the card\'s +, and taking the last one off moves it back to Add', async ({ page }) => {
  await page.goto('/')
  const add = page.getByRole('button', { name: 'Add Chest freezer' })
  await expect(async () => {
    await add.click({ timeout: RETRY_AFTER_MS })
    await expect(page.getByRole('button', { name: 'Remove one Chest freezer' })).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(add).toBeFocused()
  await page.getByRole('button', { name: 'Remove one Chest freezer' }).click()
  await expect(add).toBeFocused()
  await expect(add).toHaveText('Add')
})

for (const viewport of [WIDE, PHONE_SCREEN]) {
  test(`at ${viewport.width} px the quick edit opens under the figures, and + changes a runtime that is on screen`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/?step=4')
    const footer = page.locator('footer.footer')
    const before = await footer.innerText()
    await expect(async () => {
      await page.getByRole('button', { name: /^Appliances · / }).click({ timeout: RETRY_AFTER_MS })
      await expect(page.locator('.qedit__panel')).toBeVisible({ timeout: RETRY_AFTER_MS })
    }).toPass()
    const tiles = await page.locator('.stats').boundingBox()
    const panel = await page.locator('.qedit__panel').boundingBox()
    expect(panel!.y).toBeGreaterThanOrEqual(tiles!.y + tiles!.height)
    await page.locator('.qedit__panel').getByRole('button', { name: 'Add Refrigerator' }).click()
    await expect(footer).not.toHaveText(before)
    await expect(footer).toContainText('Runtime ~')
    await expect(footer.locator('.footer__summary')).toBeInViewport()
  })
}

test('the download action shows on arrival, and Include opens to its boxes', PHONE, async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  await expect(page.getByRole('button', { name: 'Download PDF' }).filter({ visible: true })).toBeInViewport({ ratio: 1 })
  const include = page.locator('.dl__include').filter({ visible: true })
  await expect(include.getByRole('checkbox', { name: 'Parts list' })).toBeHidden()
  await expect(include.locator('summary')).toContainText('6 of 6')
  await include.locator('summary').click()
  await include.getByRole('checkbox', { name: 'Parts list' }).uncheck()
  await expect(include.locator('summary')).toContainText('5 of 6')
})

test('step 2 asks for the hours first, with the battery settings a press away and their values on the line', async ({ page }) => {
  await page.goto('/?step=2')
  const settings = page.locator('summary', { hasText: 'Battery and motors' })
  await expect(settings).toContainText('48 V · LiFePO₄ lithium')
  await expect(page.getByRole('button', { name: /^12 V/ })).toBeHidden()
  await settings.click()
  await expect(page.getByRole('button', { name: /^12 V/ })).toBeVisible()
})
