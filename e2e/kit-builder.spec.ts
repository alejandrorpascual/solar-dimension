import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { switchLanguage, switchLanguageOnLoad } from './header'
import { PHONE } from './phone'
import { acceptNewProjectName, hideProjects, openProjectCard, renameOpenProject, showDownload, showProjects, startNewProject, startRename } from './projects'

const STORAGE_KEY = 'solar-dimension.projects.v1'

test('shell renders the stepper, a Home project and step navigation', PHONE, async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  await showProjects(page)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Home')
  await hideProjects(page)
  await page.getByRole('button', { name: 'Next: backup window' }).click()
  await expect(page).toHaveURL(/step=2/)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/step=1|\/$/)
})

test('the stepper jumps straight to any step', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  await expect(async () => {
    await page.getByRole('button', { name: 'Step 4: Your kit' }).click()
    await expect(page).toHaveURL(/step=4/, { timeout: 1000 })
  }).toPass()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await page.getByRole('button', { name: 'Step 3: Solar panels' }).click()
  await expect(page).toHaveURL(/step=3/)
  await page.getByRole('button', { name: 'Step 1: Appliances' }).click()
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Step 1: Appliances' })).toHaveAttribute('aria-current', 'step')
})

/** Web fonts swap in late on a cold CI browser and reflow the quick-edit rows; measure clicks after they settle. */
const fontsReady = (page: Page) => page.evaluate(() => document.fonts.ready.then(() => undefined))

test('moving between steps does not wait on the server', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  await fontsReady(page)
  const serverCalls: string[] = []
  page.on('request', (r) => { if (r.url().includes('/_serverFn/')) serverCalls.push(r.url()) })
  await page.getByRole('button', { name: 'Next: backup window' }).click()
  await page.getByRole('button', { name: 'Next: solar panels' }).click()
  await expect(page.getByRole('button', { name: 'Build my kit' })).toBeVisible()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await page.getByRole('button', { name: /^Appliances · / }).click()
  await page.getByRole('button', { name: 'All appliances' }).click()
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  expect(serverCalls).toEqual([])
})

test('the kit edits appliances and the window in place, shows what moved, and undoes it', async ({ page }) => {
  await page.goto('/?step=4')
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await fontsReady(page)
  const summary = page.getByText(/^Backs up \d+ appliances for/)
  await expect(summary).toContainText('for 10 hours')
  await page.getByRole('button', { name: /^Appliances · 6/ }).click()
  const panel = page.locator('.qedit__panel')
  await panel.getByRole('button', { name: 'Add Refrigerator' }).click()
  await expect(panel.getByLabel('Quantity of Refrigerator')).toHaveValue('2')
  await expect(page.locator('.stat__delta').first()).toHaveText('+150 W')

  await panel.getByLabel('Add an appliance').fill('kettle')
  await panel.getByRole('button', { name: /^Electric kettle/ }).click()
  await expect(page.getByRole('button', { name: /^Appliances · 7/ })).toBeVisible()
  await panel.getByRole('button', { name: 'Remove Electric kettle' }).click()
  await expect(page.getByRole('button', { name: /^Appliances · 6/ })).toBeVisible()

  await page.getByRole('button', { name: 'One hour more' }).click()
  await expect(summary).toContainText('for 11 hours')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(summary).toContainText('for 10 hours')
  await expect(panel.getByLabel('Quantity of Refrigerator')).toHaveValue('1')
  await expect(page.locator('.stat__delta')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
})

test('the full list is split into one labeled section per category', async ({ page }) => {
  await page.goto('/')
  const ac = page.getByRole('region', { name: 'Air conditioning', exact: true })
  await expect(ac.getByRole('heading', { level: 4 })).toHaveText(['Inverter air conditioning', 'Conventional air conditioning'])
  await expect(ac).not.toContainText('Wi-Fi router + modem')
  await expect(page.getByRole('region', { name: 'Work', exact: true })).toContainText('Wi-Fi router + modem')

  const utility = page.getByRole('region', { name: 'Utility', exact: true })
  await expect(utility).not.toContainText('added')
  await utility.getByRole('button', { name: 'Add Washing machine' }).click()
  await expect(utility).toContainText('1 added')
  await switchLanguage(page, 'Español')
  await expect(page.getByRole('region', { name: 'Servicios', exact: true })).toContainText('Agregados: 1')
  await switchLanguage(page, 'English')

  await page.getByRole('button', { name: 'Kitchen', exact: true }).click()
  await expect(page.getByRole('region')).toHaveCount(0)
})

test('a condo can type 32 cameras, and the AC list is grouped by compressor type', async ({ page }) => {
  await page.goto('/')
  const footer = page.getByText(/^Home · \d+ appliances ·/)
  const before = Number((await footer.textContent())!.match(/(\d+) appliances/)![1])
  await page.getByRole('button', { name: 'Security', exact: true }).click()
  await page.getByRole('button', { name: 'Add CCTV camera' }).click()
  const field = page.getByRole('textbox', { name: 'Quantity of CCTV camera' })
  await field.fill('32')
  await field.press('Enter')
  await expect(field).toHaveValue('32')
  await expect(footer).toContainText(`${before + 32} appliances`)
  await field.fill('500')
  await field.blur()
  await expect(field).toHaveValue('100')
  await field.fill('lots')
  await field.blur()
  await expect(field).toHaveValue('100')

  await page.getByRole('button', { name: 'Air conditioning', exact: true }).click()
  await expect(page.getByRole('main').getByRole('heading', { level: 3 })).toHaveText(['Inverter air conditioning', 'Conventional air conditioning'])
  await expect(page.getByText('1 ton · 12k BTU', { exact: true })).toHaveCount(2)
  await page.getByRole('searchbox').fill('2 ton')
  await expect(page.getByRole('main').getByRole('heading', { level: 3 })).toHaveCount(0)
  await expect(page.getByText('2 ton AC · inverter', { exact: true })).toBeVisible()
})

test('a new project can be created, renamed and deleted', PHONE, async ({ page }) => {
  await page.goto('/')
  // The new project lands on top, already renaming with its name selected.
  const name = await startNewProject(page)
  await expect(name).toBeFocused()
  await expect(name).toHaveValue('Project 2')
  await name.fill('Office')
  await acceptNewProjectName(page)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Office')
  await openProjectCard(page).getByRole('button', { name: 'More actions for Office' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Office copy')
  await openProjectCard(page).getByRole('button', { name: 'More actions for Office copy' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByRole('button', { name: 'Office copy', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Office', exact: true })).toBeVisible()
})

test('project names can be erased with backspace and replaced', PHONE, async ({ page }) => {
  await page.goto('/')
  const title = openProjectCard(page).getByRole('heading')
  const name = await startRename(page)
  await name.fill('Casa')
  await name.press('End')
  for (let i = 0; i < 4; i++) await name.press('Backspace')
  await expect(name).toHaveValue('')
  await name.pressSequentially('Portón principal')
  await name.press('Enter')
  await page.reload()
  await showProjects(page)
  await expect(title).toHaveText('Portón principal')
  await renameOpenProject(page, '   ')
  await expect(title).toHaveText('Untitled')
  await page.reload()
  await showProjects(page)
  await expect(title).toHaveText('Untitled')
  // Escape drops the edit and, inside the phone sheet, leaves the sheet open.
  await title.getByRole('button').click()
  await name.fill('Never saved')
  await name.press('Escape')
  await expect(title).toHaveText('Untitled')
})

/** Adds a second project and keeps its default name, so Home is no longer the open one. */
async function openSecondProject(page: Page): Promise<void> {
  await page.goto('/')
  await startNewProject(page)
  await acceptNewProjectName(page)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Project 2')
}

interface Box { x: number; y: number; width: number; height: number }

/** How far in from a quick-edit row's left edge to click: on the appliance's name, clear of the stepper buttons. */
const NAME_SIDE_INSET_PX = 4

/** Where an element is once it is scrolled into view and has stopped moving: the phone's sheet slides in. */
async function settledBox(target: Locator): Promise<Box> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('nothing to click: the element is not on screen')
  return box
}

/**
 * A real pointer click at a point, wherever it lands, the way a person clicks blank space on a card. locator.click
 * cannot do it: it refuses when something else is under the pointer, and here the card's stretched name button is.
 * The point has to be inside `within` first, or the click would prove nothing.
 */
async function clickPointIn(page: Page, within: Locator, point: { x: number; y: number }): Promise<void> {
  const isInside = await within.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point)
  expect(isInside, 'the point to click is not on the element it was measured for').toBe(true)
  await page.mouse.click(point.x, point.y)
}

test("clicking another project's card away from its name opens that project", PHONE, async ({ page }, testInfo) => {
  await openSecondProject(page)
  const home = page.getByRole('article', { name: 'Home' })
  const figures = await settledBox(home.locator('dl'))
  await clickPointIn(page, home, { x: figures.x + figures.width / 2, y: figures.y + figures.height / 2 })
  if (testInfo.project.name === 'phone') {
    await expect(page.getByRole('dialog')).toBeHidden()
    await showProjects(page)
  }
  const top = openProjectCard(page)
  await expect(top.getByRole('heading')).toHaveText('Home')
  await expect(top).toContainText('Current')
})

test("quick edit on another project's card shows its steppers without opening it", PHONE, async ({ page }, testInfo) => {
  await openSecondProject(page)
  const home = page.getByRole('article', { name: 'Home' })
  await home.getByRole('button', { name: 'Quick edit' }).click()
  await expect(home.getByRole('button', { name: 'Add TV, 55-inch LED' })).toBeVisible()
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Project 2')
  if (testInfo.project.name === 'phone') await expect(page.getByRole('dialog')).toBeVisible()
})

test('with quick edit open, a click between stepper rows opens nothing', PHONE, async ({ page }, testInfo) => {
  await openSecondProject(page)
  const home = page.getByRole('article', { name: 'Home' })
  await home.getByRole('button', { name: 'Quick edit' }).click()
  const list = home.getByRole('list')
  const rows = list.getByRole('listitem')
  await expect(rows.nth(1)).toBeVisible()
  // The second row is scrolled in last, so both are measured where they stay; the first sits right above it.
  await rows.nth(0).scrollIntoViewIfNeeded()
  const second = await settledBox(rows.nth(1))
  const first = await rows.nth(0).boundingBox()
  if (!first) throw new Error('the first quick edit row is not on screen')
  // The seam between the first two rows, on the name side, away from any stepper button.
  await clickPointIn(page, list, { x: first.x + NAME_SIDE_INSET_PX, y: (first.y + first.height + second.y) / 2 })
  await expect(home.getByRole('button', { name: 'Done' })).toBeVisible()
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Project 2')
  if (testInfo.project.name === 'phone') await expect(page.getByRole('dialog')).toBeVisible()
})

test('project cards show each kit and quick edit a project without opening it', async ({ page }) => {
  await page.goto('/?step=4')
  await expect(await startNewProject(page)).toHaveValue('Project 2')
  await acceptNewProjectName(page)

  const home = page.getByRole('article', { name: 'Home' })
  await expect(home).toContainText('48 V · 10 h · 6 appliances')
  const runtime = home.locator('dd').first()
  const before = await runtime.textContent()
  await home.getByRole('button', { name: 'Quick edit' }).click()
  await home.getByRole('button', { name: 'Add TV, 55-inch LED' }).click()
  await home.getByRole('button', { name: 'Add TV, 55-inch LED' }).click()
  await expect(home.getByLabel('Quantity of TV, 55-inch LED')).toHaveValue('3')
  await expect(runtime).not.toHaveText(before ?? '')
  await expect(home).toContainText('3× TV, 55-inch LED')
  const open = page.getByRole('article', { name: 'Project 2' })
  await expect(open.getByRole('button', { name: 'Project 2', exact: true })).toHaveAttribute('aria-current', 'true')
  await expect(open.getByRole('button', { name: 'Quick edit' })).toHaveCount(0)

  await home.getByRole('button', { name: 'Home', exact: true }).click()
  await hideProjects(page)
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
})

test('appliances can be added, filtered and a custom load created from volts × amps', async ({ page }) => {
  await page.goto('/')
  // A click that lands before the page hydrates does nothing; retry until the add registers, and never add twice.
  const removeAc = page.getByRole('button', { name: 'Remove one 2 ton AC · conventional' })
  await expect(async () => {
    await page.getByRole('button', { name: 'Air conditioning' }).click()
    await page.getByRole('button', { name: 'Add 2 ton AC · conventional' }).click()
    await expect(removeAc).toBeVisible({ timeout: 1000 })
  }).toPass()
  await page.getByRole('button', { name: 'All' }).click()
  await page.getByLabel('Search appliances').fill('fridge')
  await expect(page.getByText('Refrigerator', { exact: true })).toBeVisible()
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
  // A click that lands before the page hydrates does nothing; an empty form only shows the error, so clicking again is safe.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add appliance' }).click()
    await expect(page.getByText('Give the appliance a name.')).toBeVisible({ timeout: 1000 })
  }).toPass()
})

test('the custom form questions watts typed with a thousands separator, and keeps a name to what a saved project holds', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('maxlength', '80')
  await page.getByLabel('Name', { exact: true }).fill('Water pump')
  await page.getByLabel('Running W').fill('1.500')
  // A click that lands before the page hydrates does nothing; the error only shows once it registers.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add appliance' }).click()
    await expect(page.getByRole('alert')).toHaveText('Write watts as a whole number with no separator: 1500, not 1.500 or 1,500.', { timeout: 1000 })
  }).toPass()
  await page.getByLabel('Running W').fill('1500')
  await page.getByRole('button', { name: 'Add appliance' }).click()
  await expect(page.getByText('Custom · 1500 W')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Custom · 1500 W')).toBeVisible()
})

test('a custom pump that runs 30% of each hour cycles, and its duty picker changes it', async ({ page }) => {
  const saved = () => page.evaluate((key) => {
    const { custom, dutyOverrides } = JSON.parse(localStorage.getItem(key) ?? '{}').projects[0]
    return { custom, dutyOverrides }
  }, STORAGE_KEY)
  const pump = { id: 'custom1', name: 'Pool pump', watts: 1035, surge: 1035, note: 'Custom · 1035 W', duty: 0.3 }
  await page.goto('/')
  await page.getByLabel('Name', { exact: true }).fill('Pool pump')
  await page.getByLabel('Running W').fill('1035')
  await page.getByLabel('Runs % of each hour').fill('30')
  const picker = page.getByLabel('Pool pump: share of each hour it runs')
  // A click that lands before the page hydrates does nothing; once one adds the pump the form is empty, so another adds nothing.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add appliance' }).click()
    await expect(picker).toBeVisible({ timeout: 1000 })
  }).toPass()
  const card = page.locator('.card').filter({ has: picker })
  await expect(picker).toHaveValue('0.3')
  await expect(card.getByText('~311 W average', { exact: true })).toBeVisible()
  await expect.poll(saved).toEqual({ custom: [pump], dutyOverrides: {} })

  await picker.selectOption({ label: '50% of each hour' })
  await expect(card.getByText('~518 W average · typical 30%', { exact: true })).toBeVisible()
  await expect.poll(saved).toEqual({ custom: [pump], dutyOverrides: { custom1: 0.5 } })
  await page.reload()
  await expect(page.getByLabel('Pool pump: share of each hour it runs')).toHaveValue('0.5')
})

test('a saved custom appliance that no longer loads stays reported until it is removed, and a new one does not take its place', async ({ page }) => {
  // What the form used to write: a pasted product title, longer than a saved project holds. It had a count of 3 and a duty.
  await page.addInitScript((key) => {
    if (localStorage.getItem(key)) return
    const lost = { id: 'custom1', name: 'Samsung 21 cu. ft. Top Freezer Refrigerator with FlexZone and Ice Maker in Stainless RT21M6215SR', watts: 180, surge: 180, note: 'Custom · 180 W' }
    const project = {
      id: 'p1', name: 'Garita', qty: { fridge: 1, custom1: 3 }, custom: [lost], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1,
      dutyOverrides: { custom1: 0.25 },
    }
    localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
  }, STORAGE_KEY)
  const saved = () => page.evaluate((key) => {
    const { qty, dutyOverrides, custom } = JSON.parse(localStorage.getItem(key) ?? '{}').projects[0]
    return { qty, dutyOverrides, custom: custom.map((c: { id: string }) => c.id) }
  }, STORAGE_KEY)
  const onForm = page.getByText('1 custom appliance in this project could not be loaded, so the kit leaves it out. Add it again below, then remove the one that did not load.')
  const onKit = page.getByText('1 appliance in this project could not be loaded, so this kit leaves it out. Reload in a minute; if it is still missing, add it again.')

  await page.goto('/')
  await expect(onForm).toBeVisible()
  // An unrelated appliance must not take the lost one's place: not its id, its count or its duty.
  await page.getByLabel('Name', { exact: true }).fill('Phone charger')
  await page.getByLabel('Running W').fill('10')
  await expect(async () => {
    await page.getByRole('button', { name: 'Add appliance' }).click()
    await expect(page.getByText('Custom · 10 W')).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(onForm).toBeVisible()
  await expect.poll(saved).toEqual({ qty: { fridge: 1, custom1: 3, custom2: 1 }, dutyOverrides: { custom1: 0.25 }, custom: ['custom2'] })
  await page.getByRole('button', { name: 'Step 4: Your kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Garita' })).toBeVisible()
  await expect(onKit).toBeVisible()

  await page.getByRole('button', { name: 'Step 1: Appliances' }).click()
  await page.getByRole('button', { name: 'Remove the one that did not load' }).click()
  await expect(onForm).toHaveCount(0)
  await expect.poll(saved).toEqual({ qty: { fridge: 1, custom2: 1 }, dutyOverrides: {}, custom: ['custom2'] })
  await page.getByRole('button', { name: 'Step 4: Your kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Garita' })).toBeVisible()
  await expect(onKit).toHaveCount(0)
})

test('hours, voltage and chemistry change the sizing summary', async ({ page }) => {
  await page.goto('/?step=2')
  await page.getByRole('button', { name: '24 h' }).click()
  await page.getByRole('button', { name: /^12 V/ }).click()
  await page.getByRole('button', { name: /AGM lead-acid/ }).click()
  await expect(page.getByText(/24 h at 12 V/)).toBeVisible()
  await expect(page.getByLabel('Hours without the grid')).toHaveValue('24')
})

const KIT_PAGE = {
  English: {
    estimate: 'An estimate for requesting quotes, not an installation design. Have a licensed electrician verify it against the actual equipment and your local electrical code before you buy or install anything.',
    checks: 'Checks', empty: 'Garita has nothing selected yet.',
  },
  Español: {
    estimate: 'Una estimación para pedir cotizaciones, no un diseño de instalación. Pide a un electricista matriculado que la verifique con los equipos reales y la normativa eléctrica local antes de comprar o instalar nada.',
    checks: 'Verificaciones', empty: 'Garita aún no tiene nada seleccionado.',
  },
} as const

for (const language of ['English', 'Español'] as const) {
  const words = KIT_PAGE[language]

  test(`the kit says it is an estimate between the parts list and the checks, in ${language}`, PHONE, async ({ page }) => {
    await page.goto('/?step=4')
    if (language !== 'English') await switchLanguageOnLoad(page, language)
    const kit = page.getByRole('main')
    const notice = kit.getByRole('note')
    await expect(notice).toHaveText(words.estimate)
    await expect(notice).toBeVisible()
    const [parts, box, checks] = await Promise.all([kit.getByRole('table'), notice, kit.getByRole('region', { name: words.checks })].map((part) => part.boundingBox()))
    expect(box!.y).toBeGreaterThanOrEqual(parts!.y + parts!.height)
    expect(box!.y + box!.height).toBeLessThanOrEqual(checks!.y)
  })

  test(`a kit with nothing selected has no parts to qualify, so it shows no estimate sentence, in ${language}`, async ({ page }) => {
    await page.addInitScript(() => {
      const key = 'solar-dimension.projects.v1'
      if (localStorage.getItem(key)) return
      const project = { id: 'p1', name: 'Garita', qty: {}, custom: [], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1 }
      localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
    })
    await page.goto('/?step=4')
    if (language !== 'English') await switchLanguageOnLoad(page, language)
    const kit = page.getByRole('main')
    await expect(kit.getByText(words.empty)).toBeVisible()
    await expect(kit.getByRole('table')).toHaveCount(0)
    await expect(kit.getByRole('note')).toHaveCount(0)
  })
}

for (const step of [1, 2, 3, 4]) {
  test(`Privacy and Terms of use open from under step ${step}, without signing in`, async ({ page }) => {
    await page.goto(`/?step=${step}`)
    const legal = page.getByRole('navigation', { name: 'Legal' })
    await legal.getByRole('link', { name: 'Terms of use' }).click()
    await expect(page).toHaveURL(/\/terms$/)
    await expect(page.getByRole('heading', { name: 'Estimates, not an installation plan' })).toBeVisible()
    await page.goto(`/?step=${step}`)
    await legal.getByRole('link', { name: 'Privacy', exact: true }).click()
    await expect(page).toHaveURL(/\/privacy$/)
  })
}

test('full flow: appliances → window → kit, and the project survives a reload', PHONE, async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Air conditioning' }).click()
  await page.getByRole('button', { name: 'Add 2 ton AC · conventional' }).click()
  await page.getByRole('button', { name: 'Next: backup window' }).click()
  await page.getByRole('button', { name: 'Next: solar panels' }).click()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  // A 2-ton AC is usually 240 V: the inverter row names the split-phase output and a note names the AC.
  await expect(page.getByText('4,000 W continuous, not VA, pure sine, 48 V DC input, 120/240 V split-phase output')).toBeVisible()
  await expect(page.getByText('2 ton AC · conventional usually runs on 240 V. You need a split-phase (240 V) inverter or two stacked units.')).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Batteries' })).toBeVisible()
  await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Fuse' }) }).getByRole('cell').first()).toContainText('class T')
  await page.reload()
  await expect(page.getByText('4,000 W continuous, not VA, pure sine, 48 V DC input, 120/240 V split-phase output')).toBeVisible()
  await page.getByRole('button', { name: /^Appliances · / }).click()
  await expect(page.locator('.qedit__panel').getByRole('button', { name: 'Remove 2 ton AC · conventional' })).toBeVisible()
})

test('the language switch shows the app in Spanish and remembers it', async ({ page }) => {
  await page.goto('/')
  await switchLanguage(page, 'Español')
  await expect(page.getByRole('heading', { name: '¿Qué aparatos deben seguir encendidos?' })).toBeVisible()
  await expect(page.getByText('Refrigerador', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '¿Qué aparatos deben seguir encendidos?' })).toBeVisible()
  await switchLanguage(page, 'English')
  await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
})

test.describe('on a device whose preferred languages put Spanish first among the supported ones', () => {
  test.use({ locale: 'es-MX' })

  test('opens in Spanish without touching the switch, and a manual choice still wins', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('heading', { name: '¿Qué aparatos deben seguir encendidos?' })).toBeVisible()
    await switchLanguage(page, 'English')
    await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Which appliances need to stay on?' })).toBeVisible()
  })
})

test('the battery size can be chosen on the kit, is remembered, and Auto brings back the fewest batteries', async ({ page }) => {
  await page.goto('/?step=2')
  await page.getByRole('button', { name: /^12 V/ }).click()
  await page.getByRole('button', { name: 'Next: solar panels' }).click()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  const trigger = page.getByRole('button', { name: /Battery size/ })
  const batteries = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Batteries' }) })
  await expect(trigger).toContainText('Auto · 12 V 300 Ah')
  await expect(batteries).toContainText('12 V 300 Ah')

  await trigger.click()
  const twelveVolt = page.getByRole('listbox').getByRole('group', { name: /^12 V batteries/ })
  await expect(page.getByRole('option', { name: /^Auto/ })).toHaveAttribute('aria-selected', 'true')
  await twelveVolt.getByRole('option', { name: /^100 Ah/ }).click()
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(batteries).toContainText('12 V 100 Ah')
  await expect(batteries).toContainText('×5')
  await expect(trigger).toContainText('12 V 100 Ah')
  await expect(trigger).toContainText('5 batteries')

  await page.reload()
  await expect(trigger).toContainText('12 V 100 Ah')
  await trigger.click()
  await page.getByRole('option', { name: /^Auto/ }).click()
  await expect(batteries).toContainText('12 V 300 Ah')
  await expect(trigger).toContainText('Auto · 12 V 300 Ah')
})

test("a cycling appliance's on-time can be changed on the kit, moves the runtime, and is undone", async ({ page }) => {
  await page.goto('/?step=4')
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await fontsReady(page)
  await page.getByRole('button', { name: /^Appliances · 6/ }).click()
  const panel = page.locator('.qedit__panel')
  await expect(panel.getByRole('heading', { level: 3 })).toHaveCount(0)
  await expect(panel.getByText('Cycles on and off')).toBeVisible()
  const duty = panel.getByRole('combobox', { name: 'Refrigerator: share of each hour it runs' })
  await expect(duty).toHaveValue('0.35')
  await duty.selectOption('1')
  await expect(panel.getByText('150 W · ~150 W average')).toBeVisible()
  await expect(page.locator('.stat--accent .stat__delta')).toHaveText(/^−/)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(duty).toHaveValue('0.35')
  await expect(page.locator('.stat__delta')).toHaveCount(0)
})

/** The narrowest phone the kit step is laid out for. */
const NARROWEST_PHONE = { width: 320, height: 900 } as const
/** Boxes come back in fractions of a pixel; under half of one is rounding, not an overflow. */
const SUBPIXEL = 0.5

test('on the narrowest phone the quotes card wraps its long Spanish sign-in label instead of widening the page', PHONE, async ({ page }) => {
  await page.goto('/?step=4')
  await switchLanguageOnLoad(page, 'Español')
  await page.setViewportSize(NARROWEST_PHONE)
  await fontsReady(page)
  const card = page.getByRole('region', { name: '¿Te llegaron cotizaciones de instaladores?' })
  const signIn = card.getByRole('link', { name: 'Inicia sesión para comparar cotizaciones' })
  await expect(signIn).toBeVisible()
  const [cardBox, signInBox] = [await card.boundingBox(), await signIn.boundingBox()]
  if (!cardBox || !signInBox) throw new Error('the quotes card or its sign-in link is not rendered')
  expect(signInBox.x + signInBox.width, "the right edge of the sign-in link against the card's").toBeLessThanOrEqual(cardBox.x + cardBox.width + SUBPIXEL)
  // A phone widens its layout viewport to fit wider content, so compare against the width it was given.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(NARROWEST_PHONE.width)
})

test('motors starting together and a hot cable run change the inverter, the checks and the assumptions', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Air conditioning' }).click()
  await page.getByRole('button', { name: 'Add 2 ton AC · conventional' }).click()
  await page.getByRole('button', { name: 'Next: backup window' }).click()
  await page.getByRole('button', { name: /^All at once/ }).click()
  await page.locator('summary', { hasText: 'Cable run' }).click()
  await page.getByRole('button', { name: /^50 °C/ }).click()
  await expect(page.locator('summary', { hasText: 'Cable run' })).toContainText('50 °C')
  await page.getByRole('button', { name: 'Next: solar panels' }).click()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  // Fridge and AC starting together: 8,115 W peak, past a 4 kW inverter's 8,000 W surge.
  await expect(page.getByText('5,000 W continuous, not VA, pure sine, 48 V DC input')).toBeVisible()
  const checks = page.getByRole('region', { name: 'Checks' })
  await expect(checks.getByText(/^Inverter size$/)).toBeVisible()
  await expect(checks.getByText(/\(50 °C\)/)).toBeVisible()
  await expect(page.getByText(/every motor starting at once/)).toBeVisible()
  await page.reload()
  await expect(page.getByText('5,000 W continuous, not VA, pure sine, 48 V DC input')).toBeVisible()
})

test('a load past the largest inverter gets inverters in parallel, each with its own cable runs and fuses', async ({ page }) => {
  await page.goto('/')
  // Three electric water heaters put 13.5 kW on top of the starting kit: more than one 12 kW inverter carries with headroom.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add Electric water heater' }).click()
  await page.getByRole('button', { name: 'Next: backup window' }).click()
  await page.getByRole('button', { name: 'Next: solar panels' }).click()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  const row = (name: string) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) })
  await expect(row('Inverter')).toContainText('10.0 kW continuous, not VA, pure sine, 48 V DC input')
  await expect(row('Inverter')).toContainText('2 in parallel work as one 20.0 kW inverter')
  await expect(row('Inverter').getByRole('cell').last()).toHaveText(/^×\s*2$/)
  await expect(row('Fuse')).toContainText('2 runs to each inverter')
  const checks = page.getByRole('region', { name: 'Checks' })
  await expect(checks.getByText(/on 2 × 10\.0 kW inverters \(20\.0 kW together\)/)).toBeVisible()
  await expect(checks.getByText(/the 2 inverters draw up to 463 A together/)).toBeVisible()
  await expect(page.getByText(/· 2 × 10\.0 kW inverters ·/)).toBeVisible()
  // The project's card names the set too, in its short form.
  await showProjects(page)
  await expect(openProjectCard(page).getByText('2 × 10.0 kW', { exact: true })).toBeVisible()
  await hideProjects(page)
  await page.reload()
  await expect(row('Inverter')).toContainText('2 in parallel work as one 20.0 kW inverter')
  // The parts list a supplier gets counts both inverters too.
  await showDownload(page)
  await page.getByRole('radio', { name: /^Parts list \(CSV\)/ }).check()
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  const inverterLine = (await readFile((await csv.path())!, 'utf8')).split('\n').find((line) => line.startsWith('Inverter,'))
  expect(inverterLine).toContain('"10.0 kW continuous, not VA, pure sine, 48 V DC input, 120/240 V split-phase output"')
  expect(inverterLine?.trim()).toMatch(/,2$/)
})
