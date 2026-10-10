import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_QTY } from '../src/lib/store'
import { switchLanguage } from './header'
import { hideProjects, openProjectCard, renameOpenProject } from './projects'

type Language = 'English' | 'Español'
interface Box { x: number; y: number; width: number; height: number }

const STEP_NAMES: Record<Language, readonly string[]> = {
  English: ['Step 1: Appliances', 'Step 2: Backup window', 'Step 3: Solar panels', 'Step 4: Your kit'],
  Español: ['Paso 1: Electrodomésticos', 'Paso 2: Horas de respaldo', 'Paso 3: Paneles solares', 'Paso 4: Tu kit'],
}
const LOCK_TEXT: Record<Language, string> = { English: 'Add at least one appliance first', Español: 'Agrega al menos un aparato primero' }
const LANGUAGES: readonly Language[] = ['English', 'Español']
/** The header is the same on every step; step 2 has nothing wide of its own, so sideways scroll there is the header's. */
const HEADER_PAGE = '/?step=2'
const NARROWEST = 320
const WIDEST = 1920
/**
 * Finer than the 24px gap around the labelled stepper. A step must stick out of the stepper by more than that gap to
 * touch a neighbour, and it sticks out one pixel less for each pixel the header gains, so a sample always lands
 * where it still sticks out.
 */
const SWEEP_STEP = 16
/** Both sides of where the labels appear (1024px) and of where the rail does (1280px). */
const LAYOUT_SWITCHES = [1023, 1024, 1279, 1280]
/**
 * The tightest fits: the header turns into one row at 1100px of its own width (the container rule in
 * components.css), which is a 1228px window without the rail and a 1608px one with it. One pixel less is the widest
 * two-row header.
 */
const ONE_ROW_SWITCHES = [1227, 1228, 1607, 1608]
/** The widths the review named. */
const REVIEWED_WIDTHS = [1024, 1280, 1440, 1600, 1700, 1920]
/** Every width the header is measured at, from a small phone to a wide desktop, each once. */
const HEADER_WIDTHS = [...new Set([
  ...Array.from({ length: Math.floor((WIDEST - NARROWEST) / SWEEP_STEP) + 1 }, (_, i) => NARROWEST + i * SWEEP_STEP),
  ...LAYOUT_SWITCHES, ...ONE_ROW_SWITCHES, ...REVIEWED_WIDTHS,
])]
const SWEEP_HEIGHT = 900
/** Boxes come back in fractions of a pixel; less than this is rounding, not overflow. */
const SUBPIXEL = 0.5
/** Where the rail of project cards appears and the "Projects · N" button (with the name beside it) goes away. */
const RAIL_MIN_WIDTH = 1280
/** As long as a project name can be, so it cannot fit beside the button on a phone. */
const LONG_NAME = 'Grandmother’s beach house, upstairs flat and the garage shed'
/** How many appliances a new project starts with, counting each unit. */
const STARTING_APPLIANCES = Object.values(DEFAULT_QTY).reduce((sum, qty) => sum + qty, 0)

/** Web fonts swap in late on a cold browser and change every width in the header; measure after they settle. */
const fontsReady = (page: Page) => page.evaluate(() => document.fonts.ready.then(() => undefined))

const stepButtons = (page: Page, language: Language = 'English'): Locator[] =>
  STEP_NAMES[language].map((name) => page.getByRole('button', { name, exact: true }))

/** Takes every appliance out of a new Home project with the cards' own "Remove one …" buttons, on step 1. */
async function removeEveryAppliance(page: Page): Promise<void> {
  const removeOne = page.getByRole('button', { name: /^Remove one / })
  const footerCount = (count: number) => page.getByText(new RegExp(`^Home · ${count} appliances ·`))
  // A click that lands before the page hydrates does nothing; retry until the first removal shows, and only that one.
  await expect(async () => {
    if (await footerCount(STARTING_APPLIANCES).isVisible()) await removeOne.first().click({ timeout: 1000 })
    await expect(footerCount(STARTING_APPLIANCES - 1)).toBeVisible({ timeout: 1000 })
  }).toPass()
  // Hydrated from here on, so each click takes one unit off: exactly as many clicks as there are units left.
  for (let left = STARTING_APPLIANCES - 1; left > 0; left--) await removeOne.first().click()
  await expect(footerCount(0)).toBeVisible()
  await expect(removeOne).toHaveCount(0)
}

/**
 * Opens the page the header is measured on, in `language`, with its fonts loaded. Until the page hydrates the
 * language button opens no menu and `switchLanguage` would wait on one that never comes, so the button is tried
 * until it answers.
 */
async function openHeaderIn(page: Page, language: Language): Promise<void> {
  await page.goto(HEADER_PAGE)
  const trigger = page.getByRole('button', { name: /^(Language|Idioma): / })
  const menu = page.getByRole('menu')
  await expect(async () => {
    if (!(await menu.isVisible())) await trigger.click({ timeout: 1000 })
    await expect(menu).toBeVisible({ timeout: 1000 })
  }).toPass()
  // A closing menu stays in the page for the length of its exit animation: wait it out before using the button
  // again, and before measuring, where it would count as overflow.
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await switchLanguage(page, language)
  await expect(stepButtons(page, language)[0]).toBeVisible()
  await expect(menu).toHaveCount(0)
  await fontsReady(page)
}

async function boxOf(target: Locator): Promise<Box> {
  const box = await target.boundingBox()
  if (!box) throw new Error(`not on screen: ${target}`)
  return box
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const sharesRow = (a: Box, b: Box) => a.y < b.y + b.height && b.y < a.y + a.height

const right = (box: Box) => box.x + box.width
const isInside = (inner: Box, outer: Box) => inner.x >= outer.x - SUBPIXEL && right(inner) <= right(outer) + SUBPIXEL

async function neighbourBoxes(page: Page): Promise<Record<string, Box>> {
  const header = page.locator('header')
  return {
    brand: await boxOf(header.getByText('Solar Dimension', { exact: true })),
    language: await boxOf(header.getByRole('button', { name: /^(Language|Idioma): / })),
    account: await boxOf(header.getByRole('link', { name: /^(Sign in|Iniciar sesión)$/ })),
  }
}

/**
 * The stepper touches neither the brand, the language button nor the account control, no step sticks out of the
 * stepper's own box (where it would slide under a neighbour while the box itself stays clear), and the page does
 * not scroll sideways.
 */
async function expectHeaderFits(page: Page, language: Language, where: string): Promise<void> {
  const stepper = await boxOf(page.getByRole('navigation', { name: 'Steps' }))
  const steps = await Promise.all(stepButtons(page, language).map(boxOf))
  for (const [name, box] of Object.entries(await neighbourBoxes(page))) {
    expect([stepper, ...steps].some((part) => intersects(part, box)), `${where}: the stepper overlaps the ${name}`).toBe(false)
  }
  for (const [i, step] of steps.entries()) expect(isInside(step, stepper), `${where}: step ${i + 1} sticks out of the stepper`).toBe(true)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(0)
}

test('an empty project locks steps 2 to 4 until an appliance is added', async ({ page }) => {
  await page.goto('/')
  await removeEveryAppliance(page)
  const [first, ...later] = stepButtons(page)
  await expect(first).toBeEnabled()
  for (const step of later) {
    await expect(step).toBeDisabled()
    await expect(step).toHaveAttribute('title', LOCK_TEXT.English)
  }
  await page.getByRole('button', { name: 'Add Refrigerator' }).click()
  for (const step of stepButtons(page)) {
    await expect(step).toBeEnabled()
    await expect(step).not.toHaveAttribute('title')
  }
})

test('the step an empty project is on is drawn as the current one, never as locked', async ({ page }) => {
  await page.goto('/')
  await removeEveryAppliance(page)
  const steps = stepButtons(page)
  // The footer is not gated on purpose: step 2 has its own "go back and add an appliance" message.
  const forward = ['Next: backup window', 'Next: solar panels', 'Build my kit']
  for (const [i, next] of forward.entries()) {
    await page.getByRole('button', { name: next }).click()
    const current = steps[i + 1]
    await expect(current).toHaveAttribute('aria-current', 'step')
    await expect(current).toBeEnabled()
    await expect(current).not.toHaveAttribute('title')
    await expect(current.locator('.dot')).toHaveClass(/dot--cur/)
    await expect(current.locator('.dot')).not.toHaveClass(/dot--locked/)
    // The other later steps stay locked and look it, behind the current step as much as ahead of it: no "done" tick.
    for (const other of steps.slice(1).filter((s) => s !== current)) {
      await expect(other).toBeDisabled()
      await expect(other.locator('.dot')).toHaveClass(/dot--locked/)
      await expect(other.locator('.dot')).not.toHaveClass(/dot--done/)
    }
    await expect(steps[0]).toBeEnabled()
  }
})

test('the sign-in page shows the steps but none can be clicked, and none reads as locked', async ({ page }) => {
  await page.goto('/login')
  const steps = stepButtons(page)
  await expect(steps[0]).toHaveAttribute('aria-current', 'step')
  for (const step of steps) {
    await expect(step).toBeDisabled()
    await expect(step).not.toHaveAttribute('title')
    await expect(step.locator('.dot')).not.toHaveClass(/dot--locked/)
  }
})

test('in Spanish the four steps and the lock text are translated', async ({ page }) => {
  await page.goto('/')
  await removeEveryAppliance(page)
  await switchLanguage(page, 'Español')
  const steps = stepButtons(page, 'Español')
  for (const step of steps) await expect(step).toBeVisible()
  await expect(steps[0]).toHaveAttribute('aria-current', 'step')
  await expect(steps[1]).toBeDisabled()
  await expect(steps[1]).toHaveAttribute('title', LOCK_TEXT.Español)
})

for (const language of LANGUAGES) {
  test(`${language}: the stepper fits the header at this device's own width`, async ({ page }) => {
    await openHeaderIn(page, language)
    await expectHeaderFits(page, language, `${page.viewportSize()?.width}px`)
  })

  test(`${language}: the stepper fits the header from a small phone to a wide desktop`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one browser resized through every width is enough')
    await openHeaderIn(page, language)
    for (const width of HEADER_WIDTHS) {
      await page.setViewportSize({ width, height: SWEEP_HEIGHT })
      await expectHeaderFits(page, language, `${width}px`)
    }
  })

  test(`${language}: the stepper has its own row beside the rail and shares the brand's row on a wide screen`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'needs a desktop-sized window')
    await openHeaderIn(page, language)
    const stepper = page.getByRole('navigation', { name: 'Steps' })
    const brand = page.locator('header').getByText('Solar Dimension', { exact: true })
    await page.setViewportSize({ width: RAIL_MIN_WIDTH, height: SWEEP_HEIGHT })
    expect(sharesRow(await boxOf(stepper), await boxOf(brand))).toBe(false)
    await page.setViewportSize({ width: WIDEST, height: SWEEP_HEIGHT })
    expect(sharesRow(await boxOf(stepper), await boxOf(brand))).toBe(true)
  })
}

test('without the rail, steps 2 and 3 name the open project beside the Projects button', async ({ page }, testInfo) => {
  const isPhone = testInfo.project.name === 'phone'
  const chip = page.getByRole('button', { name: /^Projects · \d+$/ })
  const name = page.locator('.project-open__name')
  for (const step of [2, 3]) {
    await page.goto(`/?step=${step}`)
    if (!isPhone) {
      // From the rail's width up the open project's card is always on screen, so the button and the name are in
      // the page but not shown.
      await expect(openProjectCard(page).getByRole('heading')).toHaveText('Home')
      await expect(name).toHaveText('Home')
      await expect(name).toBeHidden()
      await expect(chip).toBeHidden()
      continue
    }
    await expect(name).toBeVisible()
    await expect(name).toHaveText('Home')
    await fontsReady(page)
    const [chipBox, nameBox] = [await boxOf(chip), await boxOf(name)]
    expect(sharesRow(chipBox, nameBox)).toBe(true)
    expect(nameBox.x).toBeGreaterThanOrEqual(chipBox.x + chipBox.width)
  }
})

test('a long project name beside the Projects button is cut with an ellipsis instead of widening the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the name only shows where the rail is hidden')
  await page.goto('/?step=2')
  const chip = page.getByRole('button', { name: /^Projects · \d+$/ })
  const sheet = page.getByRole('dialog')
  // A tap that lands before the page hydrates opens nothing; retry until the sheet is up, never tapping under it.
  await expect(async () => {
    if (!(await sheet.isVisible())) await chip.click({ timeout: 1000 })
    await expect(sheet).toBeVisible({ timeout: 1000 })
  }).toPass()
  await renameOpenProject(page, LONG_NAME)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText(LONG_NAME)
  await hideProjects(page)
  await fontsReady(page)
  const name = page.locator('.project-open__name')
  await expect(name).toHaveText(LONG_NAME)
  await expect(name).toHaveCSS('text-overflow', 'ellipsis')
  const viewportWidth = page.viewportSize()!.width
  const [chipBox, nameBox] = [await boxOf(chip), await boxOf(name)]
  expect(sharesRow(chipBox, nameBox)).toBe(true)
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(viewportWidth)
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})
