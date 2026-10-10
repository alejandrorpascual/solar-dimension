import { expect, test, type Locator, type Page } from '@playwright/test'
import { switchLanguage } from './header'

type Language = 'English' | 'Español'

/** The seeded fridge's duty picker, by its label in each language. */
const FRIDGE_DUTY: Record<Language, string> = {
  English: 'Refrigerator: share of each hour it runs',
  Español: 'Refrigerador: parte de cada hora que funciona',
}
/** Step 1 from the narrowest phone to a wide desktop: one column, the two-column grid from 640, four columns from 1024. */
const CARD_WIDTHS = [320, 360, 390, 640, 768, 1024, 1280, 1920] as const
/** The kit step: its quick-edit rows are one column below 1024 and two from there. */
const ROW_WIDTHS = [360, 390, 640, 768, 1024, 1280] as const
const VIEWPORT_HEIGHT = 900
/** Boxes come back in fractions of a pixel; under half of one is rounding, not an overflow. */
const SUBPIXEL = 0.5
/** Enough for the picker's percent beside its arrow. A picker squeezed to nothing would pass the other checks. */
const MIN_PICKER_WIDTH = 100

interface Box { x: number; y: number; width: number; height: number }

/** Web fonts swap in late on a cold browser and change every text width; measure after they settle. */
const fontsReady = (page: Page) => page.evaluate(() => document.fonts.ready.then(() => undefined))

async function boxOf(target: Locator): Promise<Box> {
  const box = await target.boundingBox()
  if (!box) throw new Error('Nothing to measure: the element is not rendered.')
  return box
}

const isInside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - SUBPIXEL && inner.y >= outer.y - SUBPIXEL &&
  inner.x + inner.width <= outer.x + outer.width + SUBPIXEL && inner.y + inner.height <= outer.y + outer.height + SUBPIXEL

const overlaps = (a: Box, b: Box): boolean =>
  a.x + SUBPIXEL < b.x + b.width && b.x + SUBPIXEL < a.x + a.width && a.y + SUBPIXEL < b.y + b.height && b.y + SUBPIXEL < a.y + a.height

/** How far the page's content is wider than its viewport, in pixels: above zero it scrolls sideways. */
const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

/** What is wrong with a duty picker's place: outside its container, over the quantity buttons, squeezed, or widening the page. */
async function pickerProblems(page: Page, picker: Locator, container: Locator, stepper: Locator): Promise<string[]> {
  const pickerBox = await boxOf(picker)
  const containerBox = await boxOf(container)
  const stepperBox = await boxOf(stepper)
  const extra = await sidewaysScroll(page)
  return [
    isInside(pickerBox, containerBox) ? '' : `the picker ${JSON.stringify(pickerBox)} leaves its container ${JSON.stringify(containerBox)}`,
    overlaps(pickerBox, stepperBox) ? `the picker ${JSON.stringify(pickerBox)} covers the quantity buttons ${JSON.stringify(stepperBox)}` : '',
    pickerBox.width >= MIN_PICKER_WIDTH ? '' : `the picker is squeezed to ${pickerBox.width} px`,
    extra > 0 ? `the page scrolls sideways by ${extra} px` : '',
  ].filter(Boolean)
}

/**
 * Picks a language as the first thing after a page load, and leaves the page ready to measure. A click that lands
 * before hydration opens no menu, and `switchLanguage` would then wait on items that never come, so this opens the menu
 * until they show. Afterwards it waits for the menu to go: while it fades out it still has a box, and on a viewport
 * narrowed under it that box is what scrolls the page sideways.
 */
async function switchLanguageOnLoad(page: Page, language: Language): Promise<void> {
  const choice = page.getByRole('menuitemradio', { name: language })
  await expect(async () => {
    if (!(await choice.isVisible())) await page.getByRole('button', { name: /^(Language|Idioma): / }).click()
    await expect(choice).toBeVisible({ timeout: 1000 })
  }).toPass()
  await choice.click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** Opens the kit step's quick-edit panel; the toggle ignores a click that lands before hydration. */
async function openQuickEdit(page: Page): Promise<Locator> {
  const toggle = page.getByRole('button', { name: /^(Appliances|Aparatos) · \d+/ })
  const panel = page.locator('.qedit__panel')
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    await expect(panel).toBeVisible({ timeout: 1000 })
  }).toPass()
  return panel
}

const cardOf = (page: Page, name: string) => page.locator('.card').filter({ has: page.getByText(name, { exact: true }) })

for (const language of ['English', 'Español'] as const) {
  test(`the duty picker stays inside its appliance card and clear of the quantity buttons at every width, in ${language}`, async ({ page }) => {
    await page.goto('/')
    if (language === 'Español') await switchLanguageOnLoad(page, language)
    const picker = page.getByLabel(FRIDGE_DUTY[language])
    await expect(picker).toBeVisible()
    const card = page.locator('.card').filter({ has: picker })
    for (const width of CARD_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
      await fontsReady(page)
      expect.soft(await pickerProblems(page, picker, card, card.locator('.stepper-qty')), `${language} at ${width} px`).toEqual([])
    }
  })

  test(`the duty picker stays inside its quick-edit row and clear of the quantity buttons at every width, in ${language}`, async ({ page }) => {
    await page.goto('/?step=4')
    if (language === 'Español') await switchLanguageOnLoad(page, language)
    const panel = await openQuickEdit(page)
    const picker = panel.getByLabel(FRIDGE_DUTY[language])
    const row = panel.locator('.qedit__row').filter({ has: page.getByLabel(FRIDGE_DUTY[language]) })
    for (const width of ROW_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
      await fontsReady(page)
      expect.soft(await pickerProblems(page, picker, row, row.locator('.qstep')), `${language} at ${width} px`).toEqual([])
    }
  })
}

test('the average on a card says how many units it adds up once there are several', async ({ page }) => {
  await page.goto('/')
  const card = cardOf(page, 'Refrigerator')
  const quantity = card.getByLabel('Quantity of Refrigerator')
  const average = card.locator('.duty__avg')
  await expect(average).toHaveText('~53 W average')
  // Typing the count is safe to repeat until the page has hydrated; a second tap on + would add a third fridge.
  await expect(async () => {
    await quantity.fill('2')
    await quantity.press('Enter')
    await expect(average).toHaveText('~105 W average for 2', { timeout: 1000 })
  }).toPass()
  await quantity.fill('1')
  await quantity.press('Enter')
  await expect(average).toHaveText('~53 W average')
})

test('a card says how much of each hour its appliance runs, and an added one can change it', async ({ page }) => {
  await page.goto('/')
  const freezer = cardOf(page, 'Chest freezer')
  await expect(freezer.getByText('Runs · 30% of each hour', { exact: true })).toBeVisible()
  await expect(cardOf(page, 'Sliding gate motor').getByText('~2 min an hour', { exact: true })).toBeVisible()

  const fridgeDuty = page.getByLabel(FRIDGE_DUTY.English)
  await expect(fridgeDuty).toBeVisible()
  await expect(async () => {
    await fridgeDuty.selectOption({ label: '75% of each hour' })
    await expect(page.getByText(/typical 35%/)).toBeVisible({ timeout: 1000 })
  }).toPass()
  await fridgeDuty.selectOption({ label: '35% · typical' })
  await expect(page.getByText(/typical 35%/)).toHaveCount(0)

  await switchLanguage(page, 'Español')
  await expect(cardOf(page, 'Congelador horizontal').getByText('Funciona · 30% de cada hora', { exact: true })).toBeVisible()
  await switchLanguage(page, 'English')

  await page.getByRole('button', { name: 'Add Chest freezer' }).click()
  await expect(page.getByLabel('Chest freezer: share of each hour it runs')).toBeVisible()
  await expect(freezer.getByText('Runs · 30% of each hour', { exact: true })).toHaveCount(0)
})
