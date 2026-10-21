import { expect, test } from '@playwright/test'
import { openProjectCard, openProjectTitle, showProjects } from './projects'

const STORAGE_KEY = 'solar-dimension.projects.v1'

test.describe('on a page in Spanish', () => {
  test.use({ locale: 'es-VE' })

  test('the first project is "Casa", a new one "Proyecto 2" and its copy "Proyecto 2 (copia)"', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '¿Qué aparatos deben seguir encendidos?' })).toBeVisible()
    await showProjects(page)
    await expect(openProjectTitle(page)).toHaveText('Casa')

    // A click that lands before the page hydrates does nothing; click until the new project's name field shows, never twice.
    const field = page.getByLabel('Nombre del proyecto')
    await expect(async () => {
      if (!(await field.isVisible())) await page.getByRole('button', { name: '+ Nuevo proyecto' }).click()
      await expect(field).toBeVisible({ timeout: 1000 })
    }).toPass()
    await expect(field).toHaveValue('Proyecto 2')
    await field.press('Enter')
    await expect(openProjectTitle(page)).toHaveText('Proyecto 2')

    await openProjectCard(page).getByRole('button', { name: 'Más acciones de Proyecto 2' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Duplicar' }).click()
    await expect(openProjectTitle(page)).toHaveText('Proyecto 2 (copia)')
    await expect(page.getByText(/^(Home|Project \d+)( copy)?$/)).toHaveCount(0)
  })

  test('a custom load is tagged "Personalizado", one saved with the English tag before the change included', async ({ page }) => {
    // What the form saved before the tag followed the language, and still saves: the tag in English.
    await page.addInitScript((key) => {
      if (localStorage.getItem(key)) return
      const saved = { id: 'custom1', name: 'Bomba vieja', watts: 180, surge: 180, note: 'Custom · 180 W' }
      const project = {
        id: 'p1', name: 'Garita', qty: { custom1: 1 }, custom: [saved], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1,
        dutyOverrides: {},
      }
      localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
    }, STORAGE_KEY)
    await page.goto('/')
    await expect(page.getByText('Personalizado · 180 W')).toBeVisible()

    await page.getByLabel('Nombre', { exact: true }).fill('Bomba de agua')
    await page.getByLabel('W en marcha').fill('1500')
    // A click that lands before the page hydrates does nothing; once one adds the load the form is empty, so another adds nothing.
    await expect(async () => {
      await page.getByRole('button', { name: 'Agregar aparato' }).click()
      await expect(page.getByText('Personalizado · 1500 W')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await expect(page.getByText(/Custom ·/)).toHaveCount(0)
  })
})
