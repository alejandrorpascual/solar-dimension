import { expect, test } from '@playwright/test'
import { switchLanguage } from './header'
import { PHONE } from './phone'

const TOO_SHORT_48 = 'A string needs at least 2 panels in series to charge a 48 V bank, and the roof holds only 1. This kit lists no panels; make room for 2 or more.'

test('a fresh project is battery-only and the step can be skipped', async ({ page }) => {
  await page.goto('/?step=3')
  await expect(page.getByRole('heading', { name: 'Do you have roof space for panels?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^No, batteries only/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: /Roof planner/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: /Solar panels/ })).toHaveCount(0)
})

test('the roof area fills the planner with the recommended panels, taps override it, and it survives a reload', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  const planner = page.getByRole('group', { name: /Roof planner/ })
  // Home: 48 V 200 Ah = 9.6 kWh bank, 4.8 h → 5 panels; 40 m² holds 13.
  await expect(planner.getByRole('button')).toHaveCount(13)
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(5)
  await expect(page.getByText('Recommended · refills the bank in a day')).toBeVisible()
  await expect(page.getByText(/^5 panels · 2\.8 kW$/)).toBeVisible()

  await planner.getByRole('button', { name: 'Add panel 8' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Back to recommended · 5' })).toBeVisible()
  await planner.getByRole('button', { name: 'Remove panel 3' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(2)

  // Grow the tapped count back above what a small roof fits, then shrink the roof to exercise the clamp.
  await planner.getByRole('button', { name: 'Add panel 8' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(8)
  const less = page.getByRole('button', { name: 'Five square metres less' })
  const more = page.getByRole('button', { name: 'Five square metres more' })
  for (let i = 0; i < 6; i++) await less.click()
  await expect(page.getByText('10 m²')).toBeVisible()
  await expect(planner.getByRole('button')).toHaveCount(3)
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(3)
  await expect(page.getByText('Recommended · the most your roof fits')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Back to recommended/ })).toHaveCount(0)
  for (let i = 0; i < 4; i++) await more.click()
  await expect(planner.getByRole('button')).toHaveCount(10)
  // The clamp is display-only: the tapped 8 is kept and returns once the roof fits it again.
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Back to recommended · 5' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to recommended · 5' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(5)

  await page.reload()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(5)
  await expect(page.getByText('30 m²')).toBeVisible()
})

test('a small roof shows fewer tiles and the kit warns about it', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  const less = page.getByRole('button', { name: 'Five square metres less' })
  for (let i = 0; i < 6; i++) await less.click()
  await expect(page.getByText('10 m²')).toBeVisible()
  await expect(page.getByRole('group', { name: /Roof planner/ }).getByRole('button')).toHaveCount(3)
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Your roof holds' })).toContainText('Your roof holds 3 panels')
})

test('sun hours change the recommendation and the flow', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  const planner = page.getByRole('group', { name: /Roof planner/ })
  await planner.getByRole('button', { name: 'Add panel 6' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(6)
  await page.getByLabel('Peak sun hours a day').fill('3')
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(6)
  await expect(page.getByRole('button', { name: 'Back to recommended · 8' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to recommended · 8' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(8)
  await expect(page.getByText(/^8 panels · 4\.4 kW$/)).toBeVisible()
  await expect(page.getByText('Recommended · refills the bank in a day')).toBeVisible()
})

test('the kit lists the solar parts', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByText('Solar recharge')).toBeVisible()
  await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Solar panels/ }) })).toContainText('×5')
  await expect(page.getByRole('rowheader', { name: /Charge controller/ })).toBeVisible()
  await expect(page.getByText(/· 5 panels$/)).toBeVisible()
})

test('the step reads in Spanish', async ({ page }) => {
  await page.goto('/?step=3')
  await switchLanguage(page, 'Español')
  await expect(page.getByRole('heading', { name: '¿Tienes espacio en el techo para paneles?' })).toBeVisible()
  await page.getByRole('button', { name: /^Sí, agregar paneles/ }).click()
  await expect(page.getByText('Recomendado · recarga el banco en un día')).toBeVisible()
  await switchLanguage(page, 'English')
})

test('a 48 V roof that holds one panel lists none and says the string is too short; at 24 V the panel stays', PHONE, async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  const planner = page.getByRole('group', { name: /Roof planner/ })
  const less = page.getByRole('button', { name: 'Five square metres less' })
  for (let i = 0; i < 7; i++) await less.click()
  await expect(page.getByText('5 m²')).toBeVisible()
  await expect(planner.getByRole('button')).toHaveCount(1)
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(0)
  await expect(page.getByText(/^0 panels · /)).toBeVisible()
  await expect(page.getByText(TOO_SHORT_48)).toBeVisible()
  await expect(page.getByText(/^Recommended · /)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  // Tapping the one tile asks for a panel that cannot charge alone, so it stays empty.
  await planner.getByRole('button', { name: 'Add panel 1' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: /Solar panels/ })).toHaveCount(0)
  await expect(page.getByRole('rowheader', { name: /Charge controller/ })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: TOO_SHORT_48 })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Your roof holds' })).toHaveCount(0)

  await page.goto('/?step=2')
  await page.getByRole('button', { name: /^24 V/ }).click()
  await page.goto('/?step=3')
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(1)
  await expect(page.getByText(/^1 panel · /)).toBeVisible()
  await expect(page.getByText(TOO_SHORT_48)).toHaveCount(0)
})

test('7 panels on a roof that fits 8 wire as 2 strings of 4, and removing the last panel always drops the count', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  const planner = page.getByRole('group', { name: /Roof planner/ })
  const less = page.getByRole('button', { name: 'Five square metres less' })
  for (let i = 0; i < 3; i++) await less.click()
  await expect(page.getByText('25 m²')).toBeVisible()
  await expect(planner.getByRole('button')).toHaveCount(8)
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(5)
  // 7 does not split into equal strings at 48 V; 6 and 8 are as near, and a tie rounds up.
  await planner.getByRole('button', { name: 'Add panel 7' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(8)
  // Asking for 7 would round straight back to 8, so removing panel 8 leaves 6.
  await planner.getByRole('button', { name: 'Remove panel 8' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(6)
  await planner.getByRole('button', { name: 'Add panel 7' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(8)

  await page.getByRole('button', { name: 'Build my kit' }).click()
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Solar panels/ }) })
  await expect(row).toContainText('×8')
  await expect(row).toContainText('2 strings of 4 in series')
})
