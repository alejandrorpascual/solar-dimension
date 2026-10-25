import { expect, test, type Locator, type Page } from '@playwright/test'

/** The width the ticket compared the rings at. */
const DESKTOP = { width: 1440, height: 900 }
/** The fast motion token (`--dur-fast` in tokens.css) as the browser computes it. */
const FAST = '0.12s'

interface Ring { style: string; width: string; color: string }

const ringOf = (target: Locator): Promise<Ring> =>
  target.evaluate((el) => {
    const css = getComputedStyle(el)
    return { style: css.outlineStyle, width: css.outlineWidth, color: css.outlineColor }
  })

/**
 * Brings keyboard focus to `target` the way Tab does: focus the control, step back and Tab onto it again. A focus()
 * call alone does not always count as keyboard focus, and only keyboard focus draws the :focus-visible ring.
 */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await target.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(target).toBeFocused()
  expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
}

/** The colour, background and border parts of a control's transition, each with its duration. */
const hoverTiming = (target: Locator) =>
  target.evaluate((el) => {
    const css = getComputedStyle(el)
    const props = css.transitionProperty.split(', ')
    const durations = css.transitionDuration.split(', ')
    return Object.fromEntries(props.map((prop, i) => [prop, durations[i % durations.length]]))
  })

/** Opens the kit step's quick-edit panel; the toggle ignores a click that lands before hydration. */
async function openQuickEdit(page: Page): Promise<Locator> {
  const toggle = page.getByRole('button', { name: /^Appliances · \d+/ })
  const panel = page.locator('.qedit__panel')
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    await expect(panel).toBeVisible({ timeout: 1000 })
  }).toPass()
  return panel
}

test('at 1440 px a category chip, Sign in and the duty select take the same 2 px accent ring as the stepper', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto('/?step=1')
  const accent = await page.evaluate(() => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--accent)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  const expected: Ring = { style: 'solid', width: '2px', color: accent }

  const stepper = page.getByRole('navigation', { name: 'Steps' }).getByRole('button').first()
  await tabTo(page, stepper)
  expect(await ringOf(stepper)).toEqual(expected)

  const chip = page.getByRole('main').getByRole('button', { name: /^Kitchen(\s|$)/ })
  await tabTo(page, chip)
  expect(await ringOf(chip), 'category chip').toEqual(expected)

  const signIn = page.getByRole('link', { name: 'Sign in' })
  await tabTo(page, signIn)
  expect(await ringOf(signIn), 'Sign in').toEqual(expected)

  await page.goto('/?step=4')
  const duty = (await openQuickEdit(page)).getByLabel('Refrigerator: share of each hour it runs')
  await tabTo(page, duty)
  expect(await ringOf(duty), 'duty select').toEqual(expected)
})

test('buttons, chips and links ease their hover colour with the same token as the solar tiles', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto('/?step=3')
  // A fresh project is battery-only; the roof planner and its tiles show once panels are on.
  const planner = page.getByRole('group', { name: /Roof planner/ })
  await expect(async () => {
    await page.getByRole('button', { name: /^Yes, add panels/ }).click()
    await expect(planner).toBeVisible({ timeout: 1000 })
  }).toPass()
  const tile = await hoverTiming(planner.getByRole('button').first())
  expect(tile['border-color']).toBe(FAST)

  await page.goto('/?step=1')
  const controls = {
    '.btn': page.locator('.btn').first(),
    '.chip': page.getByRole('main').getByRole('button', { name: /^Kitchen(\s|$)/ }),
    link: page.getByRole('link', { name: 'Sign in' }),
  }
  for (const [name, control] of Object.entries(controls)) {
    const timing = await hoverTiming(control)
    expect(timing, name).toMatchObject({ color: tile['border-color'], 'background-color': tile['border-color'], 'border-color': tile['border-color'] })
  }
})

test('with reduced motion the shared hover ease and the menu animation are off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize(DESKTOP)
  await page.goto('/?step=1')
  for (const control of [page.locator('.btn').first(), page.getByRole('link', { name: 'Sign in' })]) {
    expect(await control.evaluate((el) => getComputedStyle(el).transitionDuration.split(', ').every((d) => d === '0s'))).toBe(true)
  }
  const menu = page.getByRole('menuitemradio', { name: 'Español' })
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByRole('button', { name: /^Language: / }).click()
    await expect(menu).toBeVisible({ timeout: 1000 })
  }).toPass()
  expect(await page.locator('.hmenu__pop').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})
