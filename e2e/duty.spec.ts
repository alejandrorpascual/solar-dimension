import { expect, test, type Page } from '@playwright/test'
import { switchLanguage } from './header'

type Language = 'English' | 'Español'

/** The seeded fridge's duty picker, by its label in each language. */
const FRIDGE_DUTY: Record<Language, string> = {
  English: 'Refrigerator: share of each hour it runs',
  Español: 'Refrigerador: parte de cada hora que funciona',
}

const cardOf = (page: Page, name: string) => page.locator('.card').filter({ has: page.getByText(name, { exact: true }) })

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
