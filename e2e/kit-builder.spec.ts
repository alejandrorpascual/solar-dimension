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
