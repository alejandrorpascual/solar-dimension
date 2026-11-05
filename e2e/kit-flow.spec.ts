import { expect, test } from '@playwright/test'
import { PHONE } from './phone'
import { acceptNewProjectName, hideProjects, pickCategory, RETRY_AFTER_MS, showDownload, startNewProject } from './projects'

const WIDE = { width: 1440, height: 900 }
const PHONE_SCREEN = { width: 390, height: 844 }

test('a first visit says the list is an example, and Clear all starts an empty one', PHONE, async ({ page }) => {
  await page.goto('/')
  const note = page.locator('.toolbar__note')
  await expect(note).toContainText('An example list to start from: Refrigerator,')
  const next = page.getByRole('button', { name: 'Next: backup window' })
  await expect(next).toBeEnabled()
  await expect(async () => {
    await note.getByRole('button', { name: 'Clear all' }).click({ timeout: RETRY_AFTER_MS })
    await expect(note).toContainText('Add each one and set how many.', { timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(note.getByRole('button', { name: 'Clear all' })).toHaveCount(0)
  await expect(note).toBeFocused()
  await expect(next).toBeDisabled()
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect(note).toContainText('An example list to start from: Refrigerator,')
  await expect(note).toBeFocused()
  await expect(next).toBeEnabled()
})

test('after the first edit the note still points at the example list, with Clear all', PHONE, async ({ page }) => {
  await page.goto('/')
  const note = page.locator('.toolbar__note')
  await expect(async () => {
    await page.getByLabel('Search appliances').fill('microwave')
    await page.getByRole('button', { name: /^Add Microwave/ }).click({ timeout: RETRY_AFTER_MS })
    await expect(note).toContainText('6 on your list came from the example.', { timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(note.getByRole('button', { name: 'Clear all' })).toBeVisible()
})

test('searching air finds the air conditioners and not the hair dryer', async ({ page }) => {
  await page.goto('/')
  const search = page.getByLabel('Search appliances')
  await expect(async () => {
    await search.fill('air')
    await expect(page.getByText('2 ton AC · conventional')).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(page.getByText('Hair dryer')).toHaveCount(0)
  await search.fill('air conditioner')
  await expect(page.getByText('2 ton AC · conventional')).toBeVisible()
})

test('the Added filter lists only what is on the list, and a card taken off stays until the filter changes', PHONE, async ({ page }) => {
  await page.goto('/')
  await expect(async () => {
    await pickCategory(page, 'Added · 6')
    await expect(page.locator('.card')).toHaveCount(6, { timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(page.locator('.card--on')).toHaveCount(6)
  await page.getByRole('button', { name: 'Remove one Refrigerator' }).click()
  await expect(page.locator('.card')).toHaveCount(6)
  await expect(page.locator('.card--on')).toHaveCount(5)
})

test('a new project opens on the appliances step, where the example list is explained', PHONE, async ({ page }) => {
  await page.goto('/?step=4')
  const field = await startNewProject(page)
  await expect(field).toBeFocused()
  await field.fill('Cabin')
  await acceptNewProjectName(page)
  await expect(page).toHaveURL(/step=1/)
  await hideProjects(page)
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  await expect(page.locator('.toolbar__note')).toContainText('An example list to start from: Refrigerator,')
})

test('All appliances from the kit comes back with the list still open', PHONE, async ({ page }) => {
  await page.goto('/?step=4')
  await expect(async () => {
    await page.getByRole('button', { name: /^Appliances · / }).click()
    await page.getByRole('button', { name: 'All appliances' }).click({ timeout: RETRY_AFTER_MS })
  }).toPass()
  await page.getByRole('button', { name: 'Back to your kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All appliances' })).toBeVisible()
})

test('an empty kit says so once, and its main action adds appliances instead of Download', PHONE, async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'solar-dimension.projects.v1'
    if (localStorage.getItem(key)) return
    const project = { id: 'p1', name: 'Garita', qty: {}, custom: [], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1 }
    localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
  })
  await page.goto('/?step=4')
  const footer = page.locator('footer.footer')
  await expect(page.getByText('Garita has nothing selected yet.')).toBeVisible()
  await expect(footer.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)
  await expect(async () => {
    await footer.getByRole('button', { name: 'Add appliances' }).click({ timeout: RETRY_AFTER_MS })
    await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
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
