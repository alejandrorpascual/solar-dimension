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
async function seedRequester(page: Page, requester: Record<string, string> = LOS_SAMANES): Promise<void> {
  await page.addInitScript(([key, requester]) => {
    if (localStorage.getItem(key)) return
    const project = { id: 'p1', name: 'Garita', qty: { fridge: 1, lights: 1 }, custom: [], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1, requester }
    localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
  }, [STORAGE_KEY, requester] as const)
}

test('the spec sheet prints the requester band, and Include takes it off', async ({ page }) => {
  await seedRequester(page)
  await page.goto('/?step=4')
  await showDownload(page)
  const band = visibleBand(page)
  await expect(band.getByText('Client details')).toBeVisible()
  await expect(band.getByText('Company · Venezuela')).toBeVisible()
  await expect(band.getByText('J-40123456-7')).toBeVisible()
  await expect(band.getByText('Luis Pérez')).toBeVisible()
  await expect(band.getByText('La Trinidad, Caracas')).toBeVisible()

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  const bytes = await readFile((await pdf.path())!)
  // Page 1: header, client, figures and parts; the load schedule gets page 2.
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(2)

  await page.getByRole('checkbox', { name: 'Client details' }).uncheck()
  await expect(band).toHaveCount(0)
  await page.getByRole('radio', { name: /^Parts list \(CSV\)/ }).check()
  await expect(page.getByRole('checkbox', { name: 'Client details' })).toBeDisabled()
})

/** Creates an account. A click before the login page hydrates does nothing, so the switch to sign-up is retried. */
async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  const create = page.getByRole('button', { name: 'Create account' })
  await expect(async () => {
    if (!(await create.isVisible())) await page.getByRole('button', { name: 'No account yet? Create one' }).click()
    await expect(create).toBeVisible({ timeout: 1000 })
  }).toPass()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await create.click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
}

async function openForm(page: Page) {
  await page.getByRole('button', { name: /^Add client details/ }).click()
  return page.getByRole('dialog', { name: 'Client details' })
}

test('a client added in the Download panel prints on the sheet and stays after a reload', async ({ page }) => {
  await page.goto('/?step=4')
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
  await expect(page.getByRole('button', { name: 'Change: Junta de Condominio Res. Los Samanes' })).toBeVisible()
})

test('the form explains a bad RIF, caps long text, and Escape closes only the form', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByRole('button', { name: 'Company' }).click()
  await form.getByLabel('Country').selectOption('VE')
  await form.getByLabel('Business name').fill('x'.repeat(200))
  await expect(form.getByLabel('Business name')).toHaveValue('x'.repeat(120))
  await form.getByLabel('RIF (tax ID)').fill('4012345')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByText('A RIF has 8 digits and a check digit, like 12345678-9.')).toBeVisible()
  // Screen readers hear the error: focus moves to the first field that needs fixing.
  await expect(form.getByLabel('RIF (tax ID)')).toBeFocused()
  await expect(form.getByLabel('RIF (tax ID)')).toHaveAttribute('aria-invalid', 'true')
  await form.getByLabel('RIF (tax ID)').fill('401234567')
  await expect(form.getByText('A RIF has 8 digits and a check digit, like 12345678-9.')).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeVisible()
  await expect(visibleBand(page)).toHaveCount(0)
})

test('a person in the United States is not asked for an ID', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  await expect(form.getByLabel('Country')).toHaveValue('US')
  await expect(form.getByText('In the United States no ID is needed.', { exact: false })).toBeVisible()
  await form.getByRole('button', { name: 'Company' }).click()
  await expect(form.getByLabel('EIN')).toBeVisible()
})

/** Starts a new project from the Projects tab and comes back to the Download panel. */
async function newProject(page: Page) {
  await hideProjects(page)
  // The rail is on its Download tab (desktop); the phone opens the sheet first.
  const projectsButton = page.getByRole('button', { name: /^Projects · \d+$/ })
  if (await projectsButton.isVisible()) await projectsButton.click()
  await page.getByRole('tab', { name: /^Projects/ }).click()
  await page.getByRole('button', { name: '+ New project' }).click()
  await hideProjects(page)
  await showDownload(page)
}

test('a saved client is one tap away in a new project', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Ann Lee')
  await expect(form.getByRole('checkbox', { name: 'Save to my clients' })).toBeChecked()
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  // The add button that opened the form is gone; focus lands on the card's Change button instead of the page.
  await expect(page.getByRole('button', { name: 'Change: Ann Lee' })).toBeFocused()

  await newProject(page)
  await page.getByRole('button', { name: /^Add client details/ }).click()
  const list = page.getByRole('dialog', { name: 'Who is this spec sheet for?' })
  await expect(list.getByRole('button', { name: 'Use on the sheet' })).toBeDisabled()
  await list.getByRole('radio', { name: /Ann Lee/ }).check()
  await list.getByRole('button', { name: 'Use on the sheet' }).click()
  await expect(list).toBeHidden()
  await expect(page.getByRole('button', { name: 'Change: Ann Lee' })).toBeVisible()
})

test('a saved client can be edited and deleted from the list, and the project keeps its copy', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Ann Lee')
  await form.getByRole('button', { name: 'Save' }).click()

  await page.getByRole('button', { name: 'Change: Ann Lee' }).click()
  const list = page.getByRole('dialog', { name: 'Who is this spec sheet for?' })
  await expect(list.getByRole('radio', { name: /Ann Lee/ })).toBeChecked()
  await list.getByRole('button', { name: 'Edit: Ann Lee' }).click()
  const edit = page.getByRole('dialog', { name: 'Client details' })
  await expect(edit.getByRole('checkbox', { name: 'Save to my clients' })).toHaveCount(0)
  await edit.getByLabel('Phone').fill('+1 305 555 0100')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(list.getByText('Individual · +1 305 555 0100')).toBeVisible()

  await list.getByRole('button', { name: 'Edit: Ann Lee' }).click()
  await edit.getByRole('button', { name: 'Delete from my clients' }).click()
  // The project still has Ann Lee, now as its own row.
  await expect(list.getByText('Only in this project')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Change: Ann Lee' })).toBeVisible()
})

test('closing the form keeps what was typed, across a reload, until Start over', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Pedro Ramírez')
  await form.getByRole('checkbox', { name: 'Save to my clients' }).uncheck()
  await expect(form.getByText('Draft saved on this device')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()

  await page.reload()
  await showDownload(page)
  const again = await openForm(page)
  await expect(again.getByText('Picking up where you left off')).toBeVisible()
  await expect(again.getByLabel('Full name')).toHaveValue('Pedro Ramírez')
  // The choice not to keep this client comes back with the draft.
  await expect(again.getByRole('checkbox', { name: 'Save to my clients' })).not.toBeChecked()
  await again.getByRole('button', { name: 'Start over' }).click()
  await expect(again.getByLabel('Full name')).toHaveValue('')
  await expect(again.getByText('Picking up where you left off')).toBeHidden()
  await expect(again.getByLabel('Full name')).toBeFocused()

  await page.keyboard.press('Escape')
  const fresh = await openForm(page)
  await expect(fresh.getByText('Picking up where you left off')).toBeHidden()
})

test('with a long list of saved clients, "Use on the sheet" stays on screen', async ({ page }) => {
  await page.addInitScript(() => {
    const clients = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`, usedAt: 100 - i,
      requester: { kind: 'person', country: 'US', name: `Client ${i}`, contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' },
    }))
    localStorage.setItem('solar-dimension.clients.v1:guest', JSON.stringify(clients))
  })
  await page.goto('/?step=4')
  await showDownload(page)
  await page.getByRole('button', { name: /^Add client details/ }).click()
  const list = page.getByRole('dialog', { name: 'Who is this spec sheet for?' })
  await list.getByRole('radio', { name: /Client 0/ }).check()
  await expect(list.getByRole('button', { name: 'Use on the sheet' })).toBeInViewport()
  await list.getByRole('button', { name: 'Use on the sheet' }).click()
  await expect(page.getByRole('button', { name: 'Change: Client 0' })).toBeVisible()
})

test('Remove takes the client off this project', async ({ page }) => {
  await seedRequester(page)
  await page.goto('/?step=4')
  await showDownload(page)
  await page.getByRole('button', { name: `Change: ${LOS_SAMANES.name}` }).click()
  await page.getByRole('dialog', { name: 'Client details' }).getByRole('button', { name: 'Remove' }).click()
  await expect(visibleBand(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeFocused()
})

test('a signed-in client comes back from the account on a fresh browser', async ({ page }) => {
  const email = `e2e-req-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'correct-horse-battery'
  await signUp(page, email, password)
  await page.goto('/?step=4')
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  await showDownload(page)

  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Ann Lee')
  await form.getByRole('checkbox', { name: 'Save to my clients' }).uncheck()
  const saved = page.waitForResponse((r) => r.url().includes('/_serverFn/') && r.request().method() === 'POST' && r.ok())
  await form.getByRole('button', { name: 'Save' }).click()
  await saved

  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await page.goto('/?step=4')
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  await showDownload(page)
  await expect(page.getByRole('button', { name: 'Change: Ann Lee' })).toBeVisible()
})

test('a cédula added later to a client saved without one prints on the sheet', async ({ page }) => {
  await seedRequester(page, { kind: 'person', country: 'VE', name: 'Ana Rondón', contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' })
  await page.goto('/?step=4')
  await showDownload(page)
  await page.getByRole('button', { name: 'Change: Ana Rondón' }).click()
  const form = page.getByRole('dialog', { name: 'Client details' })
  await expect(form.getByLabel('Nationality')).toHaveValue('V')
  await form.getByLabel('Cédula (ID card)').fill('18456789')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  await expect(visibleBand(page).getByText('V-18.456.789')).toBeVisible()
})

test('clients saved while signed out are not offered to an account that signs in on the same browser', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Ann Lee')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()

  const email = `e2e-req-scope-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await signUp(page, email, 'correct-horse-battery')
  await page.goto('/?step=4')
  await expect(page.getByText('Syncing your projects…')).toBeHidden()

  await newProject(page)
  // The account has no saved clients of its own, so the form opens blank instead of the list.
  const next = await openForm(page)
  await expect(next.getByLabel('Full name')).toHaveValue('')
})

test('a client with every field at its longest still leaves the parts list whole on page one', async ({ page }) => {
  const longest = (text: string, max: number) => text.repeat(Math.ceil(max / text.length)).slice(0, max).trim()
  await seedRequester(page, {
    kind: 'company', country: 'VE',
    name: longest('Junta de Condominio Residencial Los Samanes ', 120),
    contact: longest('Luis Alberto Pérez Rondón, administrador ', 80),
    docPrefix: 'J', doc: '401234567',
    phone: '+58 414 555 0192 / +58 212 555 0100',
    email: `${longest('administracion.junta', 108)}@example.com`,
    address: longest('Avenida Principal de La Trinidad, Urbanización Los Samanes, Torre B, piso 12, ', 160),
  })
  await page.goto('/?step=4')
  await showDownload(page)
  await expect(visibleBand(page).getByText('J-40123456-7')).toBeVisible()
  // A parts list cut by the page edge would make three pages: parts, the rest of the parts, then the load schedule.
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  const bytes = await readFile((await pdf.path())!)
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(2)
})

/**
 * The phone keyboard can't be opened in a test. On iOS it shrinks only the visual viewport, so stand-in for it: report
 * a shorter `visualViewport.height` and fire its resize, which is what react-aria listens to.
 */
async function stubKeyboard(page: Page): Promise<(visibleHeight: number) => Promise<void>> {
  await page.addInitScript(() => {
    const viewport = window.visualViewport
    const real = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height')
    if (!viewport || !real?.get) return
    Object.defineProperty(viewport, 'height', {
      configurable: true,
      get: () => (window as unknown as { keyboardTop?: number }).keyboardTop ?? real.get!.call(viewport),
    })
  })
  return async (visibleHeight) => {
    await page.evaluate((h) => {
      (window as unknown as { keyboardTop?: number }).keyboardTop = h
      window.visualViewport!.dispatchEvent(new Event('resize'))
    }, visibleHeight)
  }
}

test('with the phone keyboard open, the form sheet ends above it and its last field can be reached', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the on-screen keyboard is a phone matter')
  const openKeyboard = await stubKeyboard(page)
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  const sheet = page.locator('.qdialog').filter({ has: form })
  await form.getByLabel('Installation address').focus()
  await openKeyboard(400)

  await expect.poll(async () => { const b = (await sheet.boundingBox())!; return b.y + b.height }).toBeLessThanOrEqual(400)
  // The field had focus before the keyboard shrank the sheet; the sheet must bring it back into view by itself.
  await expect.poll(async () => { const f = (await form.getByLabel('Installation address').boundingBox())!; return f.y + f.height }).toBeLessThanOrEqual(400)
})

test('on a touch screen the form fields are at least 16 px, so iOS Safari does not zoom in when one is tapped', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'iOS zooms on focus only on touch devices')
  await page.goto('/?step=4')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByRole('button', { name: 'Company' }).click()
  await form.getByLabel('Country').selectOption('VE')
  // Zoomed in, Safari scrolls the page under the dialog and react-aria stops tracking the keyboard.
  const sizes = await form.locator('input:not([type=checkbox]), select').evaluateAll((fields) =>
    fields.map((f) => parseFloat(getComputedStyle(f).fontSize)))
  expect(sizes.length).toBeGreaterThan(5)
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16)
})
