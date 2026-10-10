import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import {
  openProjectCard, openProjectMenu, openProjectMore, openProjectTitle, projectNameField, showProjects, startNewProject, startRename,
} from './projects'

/** How long one try at opening the menu waits before trying again: a press that lands before hydration does nothing. */
const RETRY_AFTER_MS = 1000

const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'phone'

/** The cards sit in a sheet only on the phone; the desktop rail never has a dialog to close. */
async function expectSheet(page: Page, testInfo: TestInfo, state: 'open' | 'closed'): Promise<void> {
  const sheet = page.getByRole('dialog')
  if (isPhone(testInfo) && state === 'open') await expect(sheet).toBeVisible()
  else await expect(sheet).toBeHidden()
}

/** Adds a second project and leaves it open with its default name, the cards still showing. */
async function addProject(page: Page): Promise<void> {
  const field = await startNewProject(page)
  await field.press('Escape')
  await expect(field).toBeHidden()
}

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

for (const action of ['Duplicate', 'Delete'] as const) {
  test(`${action} from the ··· menu puts focus on the title of the project it opens`, async ({ page }, testInfo) => {
    await page.goto('/')
    await addProject(page)
    const menu = await openProjectMenu(page)
    await menu.getByRole('menuitem', { name: action }).click()
    const title = openProjectTitle(page)
    await expect(title).toHaveText(action === 'Duplicate' ? 'Project 2 copy' : 'Home')
    await expect(title).toBeFocused()
    await afterNextFrames(page)
    await expect(title).toBeFocused()
    await expectSheet(page, testInfo, 'open')
    // Focus is inside the sheet, so Escape reaches it.
    await page.keyboard.press('Escape')
    await expectSheet(page, testInfo, 'closed')
  })
}

test('a name is saved as it is typed: a reload with the field still open keeps it', async ({ page }) => {
  await page.goto('/')
  const field = await startRename(page)
  await page.keyboard.type('Workshop')
  await expect(field).toHaveValue('Workshop')
  await page.reload()
  await showProjects(page)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Workshop')
})

test('a name field left empty is stored as Untitled, even if the field never closes', async ({ page }) => {
  await page.goto('/')
  const field = await startRename(page)
  await page.keyboard.press('Backspace')
  await expect(field).toHaveValue('')
  await page.reload()
  await showProjects(page)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Untitled')
})

test('Escape puts back the name the rename started with, though every keystroke was saved', async ({ page }, testInfo) => {
  await page.goto('/')
  const field = await startRename(page)
  await page.keyboard.type('Never kept')
  await expect(field).toHaveValue('Never kept')
  await page.keyboard.press('Escape')
  const title = openProjectTitle(page)
  await expect(title).toHaveText('Home')
  await expect(title).toBeFocused()
  await expectSheet(page, testInfo, 'open')
  await page.reload()
  await showProjects(page)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Home')
})
