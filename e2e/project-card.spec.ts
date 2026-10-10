import { expect, test, type Locator, type Page } from '@playwright/test'
import { openProjectCard, openProjectMore, projectNameField, showProjects } from './projects'

/** How long one try at opening the menu waits before trying again: a press that lands before hydration does nothing. */
const RETRY_AFTER_MS = 1000

const selectedText = (field: Locator) =>
  field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))

/** react-aria puts focus back one animation frame after its menu unmounts; wait past that frame, not for a guessed time. */
const afterNextFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))

type MenuInput = 'mouse' | 'touch' | 'keyboard'

/** Opens the open project's ··· menu and chooses Rename, the way each kind of input does it. */
async function chooseRename(page: Page, input: MenuInput): Promise<void> {
  const more = openProjectMore(page)
  const rename = page.getByRole('menuitem', { name: 'Rename' })
  const press = (target: Locator) => (input === 'touch' ? target.tap() : target.click())
  await expect(async () => {
    if (!(await rename.isVisible())) {
      if (input === 'keyboard') {
        await more.focus()
        await page.keyboard.press('Enter')
      } else {
        await press(more)
      }
    }
    await expect(rename).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
  if (input !== 'keyboard') return press(rename)
  // Opened from the keyboard, the menu starts on its first item.
  await expect(rename).toBeFocused()
  await page.keyboard.press('Enter')
}

for (const input of ['mouse', 'touch', 'keyboard'] as const) {
  test(`Rename chosen from the ··· menu by ${input} lands in the name field, ready to type`, async ({ page, hasTouch }) => {
    test.skip(input === 'touch' && !hasTouch, 'this project has no touch screen')
    await page.goto('/')
    await showProjects(page)
    await chooseRename(page, input)
    const field = projectNameField(page)
    await expect(field).toBeFocused()
    expect(await selectedText(field)).toBe('Home')
    await afterNextFrames(page)
    await expect(field).toBeFocused()
    // Typed at whatever holds focus, so this only renames if the field really has it.
    await page.keyboard.type('Garage')
    await expect(field).toHaveValue('Garage')
    await page.keyboard.press('Enter')
    await expect(openProjectCard(page).getByRole('heading')).toHaveText('Garage')
  })
}
