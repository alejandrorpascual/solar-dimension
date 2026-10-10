import { expect, test, type Page } from '@playwright/test'

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
