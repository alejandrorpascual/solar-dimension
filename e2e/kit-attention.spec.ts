import { expect, test, type Locator, type Page } from '@playwright/test'
import { switchLanguageOnLoad } from './header'
import { PHONE } from './phone'
import { RETRY_AFTER_MS } from './projects'

const STORAGE_KEY = 'solar-dimension.projects.v1'

/** A saved 12 V AGM project with these loads and this battery, opened on first load. */
const seedAgmProject = (page: Page, patch: { qty: Record<string, number>; hours: number; batteryUnit: string | null }) =>
  page.addInitScript(({ key, patch }) => {
    if (localStorage.getItem(key)) return
    const project = { id: 'p1', name: 'Garita', custom: [], volts: 12, chemistry: 'agm', updatedAt: 1, ...patch }
    localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
  }, { key: STORAGE_KEY, patch })

/** Taps the line and waits for the checks: a tap that lands before hydration moves nothing, so it taps until they show. */
async function tapToChecks(line: Locator, checks: Locator): Promise<void> {
  await expect(async () => {
    await line.click()
    await expect(checks).toBeInViewport({ timeout: RETRY_AFTER_MS })
  }).toPass()
}

/** Opens the battery picker; a click that lands before hydration opens nothing, so it clicks until the list shows. */
async function openBatteryPicker(page: Page): Promise<void> {
  const sizes = page.getByRole('listbox')
  await expect(async () => {
    if (!(await sizes.isVisible())) await page.getByRole('button', { name: /Battery size|Tamaño de batería/ }).click()
    await expect(sizes).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
}

const ATTENTION = { English: { line: '2 checks need attention', checks: 'Checks' }, Español: { line: '2 verificaciones necesitan atención', checks: 'Verificaciones' } } as const

for (const language of ['English', 'Español'] as const) {
  const words = ATTENTION[language]

  test(`a kit with 2 failing checks says so under its summary and in the footer, and the line moves to the checks, in ${language}`, PHONE, async ({ page }, testInfo) => {
    // A microwave for 8 h on 12 V 100 Ah AGM units: the bank's continuous current and the fuse need attention.
    await seedAgmProject(page, { qty: { micro: 1 }, hours: 8, batteryUnit: '12-100' })
    await page.goto('/?step=4')
    if (language !== 'English') await switchLanguageOnLoad(page, language)
    const kitLine = page.locator('.kit__head').getByRole('button', { name: words.line, exact: true })
    const footerLine = page.locator('footer.footer').getByRole('button', { name: words.line, exact: true })
    await expect(kitLine).toBeVisible()
    await expect(footerLine).toBeVisible()
    const checks = page.getByRole('region', { name: words.checks })
    await expect(checks).not.toBeInViewport()
    await tapToChecks(kitLine, checks)
    await expect(checks).toBeFocused()
    // On a phone the footer stays on screen, so its line is the one at hand anywhere on the page.
    if (testInfo.project.name !== 'phone') return
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(checks).not.toBeInViewport()
    await tapToChecks(footerLine, checks)
  })
}

test('a kit that passes every check shows no attention line', async ({ page }) => {
  await page.goto('/?step=4')
  await expect(page.getByRole('region', { name: 'Checks' })).toBeVisible()
  await expect(page.getByRole('button', { name: /need(s)? attention/ })).toHaveCount(0)
})

const PICKER = {
  English: { auto: 'Auto', best: 'Best fit', group: /^12 V batteries/, tags: ['Continuous current too low', 'Peak current too low'] },
  Español: { auto: 'Automático', best: 'La mejor opción', group: /^Baterías de 12 V/, tags: ['Corriente continua insuficiente', 'Corriente pico insuficiente'] },
} as const

for (const language of ['English', 'Español'] as const) {
  const words = PICKER[language]

  test(`with no bank that can feed the inverter, Auto is not the best fit and rows that fail are tagged, in ${language}`, async ({ page }) => {
    // The fridge, microwave and kettle draw 370 A: no 12 V AGM bank gives it, two 6 V 225 Ah units come closest.
    await seedAgmProject(page, { qty: { fridge: 1, micro: 1, kettle: 1 }, hours: 2, batteryUnit: null })
    await page.goto('/?step=4')
    if (language !== 'English') await switchLanguageOnLoad(page, language)
    await openBatteryPicker(page)
    const auto = page.getByRole('option', { name: new RegExp(`^${words.auto}`) })
    await expect(auto).toHaveAccessibleName(words.auto)
    await expect(auto).toContainText('6 V 225 Ah')
    await expect(auto).not.toContainText(words.best)
    const small = page.getByRole('listbox').getByRole('group', { name: words.group }).getByRole('option', { name: /^100 Ah/ })
    for (const tag of words.tags) await expect(small).toContainText(tag)
  })
}
