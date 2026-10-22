import { expect, test, type Page } from '@playwright/test'
import { PHONE } from './phone'
import { RETRY_AFTER_MS } from './projects'

/** A group of toggle buttons: each option's accessible name, matched from its start (an option may add a hint after it). */
type Group = Record<string, RegExp>

const startsWith = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
const groupOf = (labels: readonly string[]): Group => Object.fromEntries(labels.map((label) => [label, startsWith(label)]))

const VOLTAGES = groupOf(['12 V', '24 V', '36 V', '48 V'])
const CHEMISTRIES = groupOf(['LiFePO₄ lithium', 'AGM lead-acid'])
const HOUR_PRESETS = groupOf(['4 h', '8 h', '10 h', '12 h', '24 h', '48 h'])
const CATEGORIES = groupOf(['All', 'Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal', 'Custom'])
const MODES = groupOf(['Watts', 'Volts × amps'])

const button = (page: Page, name: RegExp) => page.getByRole('main').getByRole('button', { name })

/** Every option of `group` exposes aria-pressed: "true" on `selected` (or on none, when it is null), "false" on the rest. */
async function expectOnlyPressed(page: Page, group: Group, selected: string | null): Promise<void> {
  for (const [label, name] of Object.entries(group)) {
    await expect(button(page, name), `${label} pressed`).toHaveAttribute('aria-pressed', String(label === selected))
  }
}

/** Clicks an option until it reads pressed: a click that lands before the page hydrates does nothing. Never clicks twice. */
async function press(page: Page, group: Group, label: string): Promise<void> {
  const option = button(page, group[label] ?? startsWith(label))
  await expect(async () => {
    if ((await option.getAttribute('aria-pressed')) !== 'true') await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true', { timeout: RETRY_AFTER_MS })
  }).toPass()
}

const slider = (page: Page) => page.getByRole('slider', { name: 'Hours without the grid' })

/** The slider's live value (the DOM property, which a browser clamps to max) and the hours the page prints beside it. */
async function sliderReads(page: Page): Promise<{ value: string; max: string | null; printed: string }> {
  const range = slider(page)
  return {
    value: await range.inputValue(),
    max: await range.getAttribute('max'),
    printed: (await page.locator('.hours-value').innerText()).trim(),
  }
}

test('step 2: choosing a voltage, chemistry and hour preset moves the pressed state to that option only', async ({ page }) => {
  await page.goto('/?step=2')
  // The Home project starts at 48 V, LiFePO₄ and 10 h.
  await expectOnlyPressed(page, VOLTAGES, '48 V')
  await expectOnlyPressed(page, CHEMISTRIES, 'LiFePO₄ lithium')
  await expectOnlyPressed(page, HOUR_PRESETS, '10 h')
  await press(page, VOLTAGES, '24 V')
  await expectOnlyPressed(page, VOLTAGES, '24 V')
  await press(page, CHEMISTRIES, 'AGM lead-acid')
  await expectOnlyPressed(page, CHEMISTRIES, 'AGM lead-acid')
  await press(page, HOUR_PRESETS, '12 h')
  await expectOnlyPressed(page, HOUR_PRESETS, '12 h')
  // An hour count no preset has leaves every preset unpressed.
  await slider(page).fill('60')
  await expect(page.locator('.hours-value')).toHaveText('60 h')
  await expectOnlyPressed(page, HOUR_PRESETS, null)
})

test('step 1: the category filter and the custom form mode press the option in effect only', async ({ page }) => {
  await page.goto('/')
  await expectOnlyPressed(page, CATEGORIES, 'All')
  await expectOnlyPressed(page, MODES, 'Watts')
  await press(page, CATEGORIES, 'Kitchen')
  await expectOnlyPressed(page, CATEGORIES, 'Kitchen')
  await press(page, MODES, 'Volts × amps')
  await expectOnlyPressed(page, MODES, 'Volts × amps')
  await press(page, MODES, 'Watts')
  await expectOnlyPressed(page, MODES, 'Watts')
})

test('a project set to 60 h keeps a slider at 60 h after a reload, and the slider reaches 72 h', async ({ page }) => {
  await page.goto('/?step=2')
  const range = slider(page)
  await expect(async () => {
    await range.fill('60')
    await expect(page.locator('.hours-value')).toHaveText('60 h', { timeout: RETRY_AFTER_MS })
  }).toPass()
  expect(await sliderReads(page)).toEqual({ value: '60', max: '72', printed: '60 h' })
  await page.reload()
  await expect(page.locator('.hours-value')).toHaveText('60 h')
  expect(await sliderReads(page)).toEqual({ value: '60', max: '72', printed: '60 h' })
  // The right end of the slider: End on a focused range input takes it to its maximum.
  await range.focus()
  await page.keyboard.press('End')
  await expect(page.locator('.hours-value')).toHaveText('72 h')
  expect(await sliderReads(page)).toEqual({ value: '72', max: '72', printed: '72 h' })
})

test('the create-account form on /login has one level-1 heading', async ({ page }) => {
  await page.goto('/login')
  const heading = page.getByRole('heading', { level: 1 })
  await expect(async () => {
    if ((await heading.innerText()) !== 'Create account') await page.getByRole('button', { name: 'No account yet? Create one' }).click()
    await expect(heading).toHaveText('Create account', { timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(heading).toHaveCount(1)
})

test('a page load leaves focus where the browser put it, not on the step heading', async ({ page }) => {
  await page.goto('/?step=3')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Do you have roof space for panels?')
  // The page's scripts have loaded and run, so a focus on mount would have happened by now.
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { level: 1 })).not.toBeFocused()
})

test('Next and Back from the keyboard focus the new step heading, on a phone too', PHONE, async ({ page }) => {
  await page.goto('/')
  const heading = page.getByRole('heading', { level: 1 })
  const next = page.getByRole('button', { name: 'Next: backup window', exact: true })
  await expect(async () => {
    if (!/step=2/.test(page.url())) {
      await next.focus()
      await page.keyboard.press('Enter')
    }
    await expect(page).toHaveURL(/step=2/, { timeout: RETRY_AFTER_MS })
  }).toPass()
  await expect(heading).toHaveText('How long should the backup last?')
  await expect(heading).toBeFocused()
  await page.getByRole('button', { name: 'Back', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(heading).toHaveText('Which appliances need to stay on?')
  await expect(heading).toBeFocused()
})

