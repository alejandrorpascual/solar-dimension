import { expect, test } from '@playwright/test'

test('shell renders the stepper, a Home project and step navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible()
  await page.getByRole('button', { name: 'Next: backup window' }).click()
  await expect(page).toHaveURL(/step=2/)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/step=1|\/$/)
})

test('a new project can be created, renamed and deleted', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '+ New project' }).click()
  const name = page.getByLabel('Project name')
  await name.fill('Office')
  await name.blur()
  await expect(page.getByRole('button', { name: 'Office' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('button', { name: 'Office' })).toHaveCount(0)
})

test('appliances can be added, filtered and a custom load created from volts × amps', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Air conditioning' }).click()
  await page.getByRole('button', { name: 'Add 2 ton AC · conventional' }).click()
  await expect(page.getByRole('button', { name: 'Remove one 2 ton AC · conventional' })).toBeVisible()
  await page.getByRole('button', { name: 'All' }).click()
  await page.getByLabel('Search appliances').fill('fridge')
  await expect(page.getByText('Refrigerator')).toBeVisible()
  await expect(page.getByText('Chest freezer')).toHaveCount(0)
  await page.getByLabel('Search appliances').fill('')
  await page.getByRole('button', { name: 'Volts × amps' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Pool pump')
  await page.getByLabel('Volts').fill('230')
  await page.getByLabel('Amps').fill('4.5')
  await page.getByRole('button', { name: 'Add appliance' }).click()
  await expect(page.getByText('Custom · 230 V × 4.5 A')).toBeVisible()
  await page.getByRole('button', { name: 'Remove Pool pump' }).click()
  await expect(page.getByText('Pool pump')).toHaveCount(0)
})

test('the custom form explains what is missing', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add appliance' }).click()
  await expect(page.getByText('Give the appliance a name.')).toBeVisible()
})
