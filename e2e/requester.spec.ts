import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { showDownload } from './projects'

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
