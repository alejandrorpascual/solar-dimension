import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { hideProjects, showDownload } from './projects'

const STORAGE_KEY = 'solar-dimension.projects.v1'
const LOS_SAMANES = {
  kind: 'company', country: 'VE', name: 'Junta de Condominio Res. Los Samanes', contact: 'Luis Pérez',
  docPrefix: 'J', doc: '401234567', phone: '+58 414 555 0192', email: '', address: 'La Trinidad, Caracas',
}

/** The requester band on screen: on phones a hidden copy of the Download panel stays mounted in the desktop rail. */
const visibleBand = (page: Page) => page.locator('.ksheet__client').filter({ visible: true })

/** Opens the app with one saved project that already has a requester. Later reloads keep whatever the test changed. */
async function seedRequester(page: Page): Promise<void> {
  await page.addInitScript(([key, requester]) => {
    if (localStorage.getItem(key)) return
    const project = { id: 'p1', name: 'Garita', qty: { fridge: 1, lights: 1 }, custom: [], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1, requester }
    localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
  }, [STORAGE_KEY, LOS_SAMANES] as const)
}

test('the spec sheet prints the requester band, and Include takes it off', async ({ page }) => {
  await seedRequester(page)
  await page.goto('/?step=3')
  await showDownload(page)
  const band = visibleBand(page)
  await expect(band.getByText('Client details')).toBeVisible()
  await expect(band.getByText('Company · Venezuela')).toBeVisible()
  await expect(band.getByText('J-40123456-7')).toBeVisible()
  await expect(band.getByText('Luis Pérez')).toBeVisible()
  await expect(band.getByText('La Trinidad, Caracas')).toBeVisible()

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  const bytes = await readFile((await pdf.path())!)
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1)

  await page.getByRole('checkbox', { name: 'Client details' }).uncheck()
  await expect(band).toHaveCount(0)
  await page.getByRole('radio', { name: /^Parts list \(CSV\)/ }).check()
  await expect(page.getByRole('checkbox', { name: 'Client details' })).toBeDisabled()
})

async function openForm(page: Page) {
  await page.getByRole('button', { name: /^Add client details/ }).click()
  return page.getByRole('dialog', { name: 'Client details' })
}

test('a client added in the Download panel prints on the sheet and stays after a reload', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByRole('button', { name: 'Company' }).click()
  await form.getByLabel('Country').selectOption('VE')
  await form.getByLabel('Business name').fill('Junta de Condominio Res. Los Samanes')
  await form.getByLabel('RIF (tax ID)').fill('J-40123456-7')
  await expect(form.getByLabel('RIF type')).toHaveValue('J')
  await expect(form.getByLabel('RIF (tax ID)')).toHaveValue('40123456-7')
  await form.getByLabel('Phone').fill('+58 414 555 0192')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  await expect(visibleBand(page).getByText('J-40123456-7')).toBeVisible()
  await expect(page.getByText('RIF J-40123456-7 · +58 414 555 0192').filter({ visible: true })).toBeVisible()

  await page.reload()
  await showDownload(page)
  await expect(page.getByRole('button', { name: 'Edit: Junta de Condominio Res. Los Samanes' })).toBeVisible()
})

test('the form explains a bad RIF, caps long text, and Escape closes only the form', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByRole('button', { name: 'Company' }).click()
  await form.getByLabel('Country').selectOption('VE')
  await form.getByLabel('Business name').fill('x'.repeat(200))
  await expect(form.getByLabel('Business name')).toHaveValue('x'.repeat(120))
  await form.getByLabel('RIF (tax ID)').fill('4012345')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByText('A RIF has 8 digits and a check digit, like 12345678-9.')).toBeVisible()
  await expect(form.getByLabel('RIF (tax ID)')).toHaveAttribute('aria-invalid', 'true')
  await form.getByLabel('RIF (tax ID)').fill('401234567')
  await expect(form.getByText('A RIF has 8 digits and a check digit, like 12345678-9.')).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeVisible()
  await expect(visibleBand(page)).toHaveCount(0)
})

test('a person in the United States is not asked for an ID', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await expect(form.getByLabel('Country')).toHaveValue('US')
  await expect(form.getByText('In the United States no ID is needed.', { exact: false })).toBeVisible()
  await form.getByRole('button', { name: 'Company' }).click()
  await expect(form.getByLabel('EIN')).toBeVisible()
})

test('saved details fill the form of a new project when "use in my other projects" is on', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Ann Lee')
  await expect(form.getByRole('checkbox', { name: 'Use these details in my other projects' })).toBeChecked()
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  // The add button that opened the form is gone; focus lands on the card's Edit button instead of the page.
  await expect(page.getByRole('button', { name: 'Edit: Ann Lee' })).toBeFocused()

  await hideProjects(page)
  // The rail is on its Download tab (desktop); the phone opens the sheet first.
  const projectsButton = page.getByRole('button', { name: /^Projects · \d+$/ })
  if (await projectsButton.isVisible()) await projectsButton.click()
  await page.getByRole('tab', { name: /^Projects/ }).click()
  await page.getByRole('button', { name: '+ New project' }).click()
  await hideProjects(page)
  await showDownload(page)
  const next = await openForm(page)
  await expect(next.getByLabel('Full name')).toHaveValue('Ann Lee')
})

test('Remove takes the client off this project', async ({ page }) => {
  await seedRequester(page)
  await page.goto('/?step=3')
  await showDownload(page)
  await page.getByRole('button', { name: `Edit: ${LOS_SAMANES.name}` }).click()
  await page.getByRole('dialog', { name: 'Client details' }).getByRole('button', { name: 'Remove' }).click()
  await expect(visibleBand(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeFocused()
})
