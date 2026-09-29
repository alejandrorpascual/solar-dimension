import { expect, test } from '@playwright/test'
import { accountAction } from './header'
import { hideProjects, showProjects } from './projects'

test('sign up, keep a project across reload and sign-out/sign-in', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'correct-horse-battery'
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await showProjects(page)
  await page.getByRole('button', { name: '+ New project' }).click()
  await hideProjects(page)
  const name = page.getByLabel('Project name')
  await name.fill('Beach house')
  await name.blur()
  await expect(name).toHaveValue('Beach house')
  await page.reload()
  await showProjects(page)
  await expect(page.getByRole('button', { name: 'Beach house' })).toBeVisible()
  await hideProjects(page)
  await page.goto('/login')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await accountAction(page, 'Sign out')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await showProjects(page)
  await expect(page.getByRole('button', { name: 'Beach house' })).toBeVisible()
})
