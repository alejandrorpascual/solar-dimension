import { expect, test, type Page } from '@playwright/test'
import { switchLanguageOnLoad } from './header'
import { PHONE } from './phone'

const STORAGE_KEY = 'solar-dimension.projects.v1'

/** A saved 48 V project with one microwave, opened on first load. */
const seedMicrowave = (page: Page) =>
  page.addInitScript((key) => {
    if (localStorage.getItem(key)) return
    const project = { id: 'p1', name: 'Home', custom: [], volts: 48, chemistry: 'lifepo4', qty: { micro: 1 }, hours: 24, batteryUnit: null, updatedAt: 1 }
    localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
  }, STORAGE_KEY)

const glossary = (page: Page) => page.locator('details.gloss')

/** Opens the disclosure; a click before hydration opens nothing, so it clicks until the terms show. */
async function openGlossary(page: Page): Promise<void> {
  const list = glossary(page).locator('dl')
  await expect(glossary(page)).toBeVisible()
  await expect(async () => {
    if (!(await list.isVisible())) await glossary(page).locator('summary').click()
    await expect(list).toBeVisible({ timeout: 1000 })
  }).toPass()
}

test('the kit step\'s Glossary opens on click and lists 11 terms, with the hard and light day figures', async ({ page }, info) => {
  await seedMicrowave(page)
  await page.goto('/?step=4')
  await expect(glossary(page)).toBeVisible()
  await expect(glossary(page)).not.toHaveAttribute('open', '')
  await glossary(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`${info.project.name}-closed.png`) })
  await openGlossary(page)
  await expect(glossary(page).locator('dt')).toHaveCount(11)
  await expect(glossary(page).locator('dt').first()).toHaveText('Running watts')
  await expect(glossary(page).locator('dt').last()).toHaveText('Hard day and light day')
  const hardLight = glossary(page).locator('dd').last()
  await expect(hardLight).toContainText('80%')
  await expect(hardLight).toContainText('93%')
  await expect(hardLight).toContainText('130%')
  await expect(hardLight).toContainText('100%')
  await expect(hardLight).toContainText('85%')
  await glossary(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`${info.project.name}-open.png`) })
  await glossary(page).screenshot({ path: info.outputPath(`${info.project.name}-open-crop.png`) })
})

test('the Glossary reads in Spanish', PHONE, async ({ page }, info) => {
  await seedMicrowave(page)
  await page.goto('/?step=4')
  await switchLanguageOnLoad(page, 'Español')
  await expect(glossary(page).locator('summary')).toHaveText('Glosario')
  await openGlossary(page)
  await expect(glossary(page).locator('dt')).toHaveCount(11)
  await expect(glossary(page).locator('dt').first()).toHaveText('Vatios en marcha')
  await glossary(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`${info.project.name}-es-open.png`) })
})
