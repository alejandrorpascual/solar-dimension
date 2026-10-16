import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { PHONE } from './phone'
import {
  openProjectCard, openProjectMenu, openProjectMore, openProjectTitle, projectNameField, RETRY_AFTER_MS, showProjects, startNewProject, startRename,
} from './projects'

/** Sizes read back from computed styles are rounded; two that differ by less than this are the same size. */
const SAME_SIZE_WITHIN_PX = 1

const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'phone'

/** Web fonts swap in late on a cold browser and change every text height; measure after they settle. */
const fontsReady = (page: Page) => page.evaluate(() => document.fonts.ready.then(() => undefined))

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
  test(`Rename chosen from the ··· menu by ${input} lands in the name field, ready to type`, PHONE, async ({ page, hasTouch }) => {
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
  test(`${action} from the ··· menu puts focus on the title of the project it opens`, PHONE, async ({ page }, testInfo) => {
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

test('Escape puts back the name the rename started with, though every keystroke was saved', PHONE, async ({ page }, testInfo) => {
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

/**
 * Presses a button the way a scripted click does: focus stays where it was. A name field that had focus is then
 * removed while it still has it, and React never tells the app it blurred.
 */
/** A key press as the browser reports it while an input method is choosing a candidate: the key is the input method's. */
const pressWhileComposing = (field: Locator, key: 'Enter' | 'Escape') =>
  field.dispatchEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true })

test('Enter and Escape that an input method is using leave the name field open with what was typed', PHONE, async ({ page }, testInfo) => {
  await page.goto('/')
  const field = await startRename(page)
  await page.keyboard.type('Casa')
  await expect(field).toHaveValue('Casa')
  // Dismissing a Japanese or Chinese candidate with Escape, or picking one with Enter, must not end the rename.
  await pressWhileComposing(field, 'Escape')
  await pressWhileComposing(field, 'Enter')
  await expect(field).toBeVisible()
  await expect(field).toHaveValue('Casa')
  await expect(field).toBeFocused()
  await expectSheet(page, testInfo, 'open')
  // The same keys outside a composition still work.
  await page.keyboard.press('Enter')
  await expect(openProjectTitle(page)).toHaveText('Casa')
})

const pressWithoutFocus = (button: Locator) => button.evaluate((el: HTMLElement) => el.click())

test('a rename ends when another project is opened, even if the name field never blurred', PHONE, async ({ page }, testInfo) => {
  await page.goto('/')
  await addProject(page)
  const field = await startRename(page)
  await expect(field).toHaveValue('Project 2')
  await pressWithoutFocus(page.getByRole('button', { name: 'Home', exact: true }))
  // Opening a card closes the phone's sheet; the desktop rail stays.
  if (isPhone(testInfo)) await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await showProjects(page)
  await expect(openProjectTitle(page)).toHaveText('Home')
  await page.getByRole('button', { name: 'Project 2', exact: true }).click()
  if (isPhone(testInfo)) await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await showProjects(page)
  await expect(openProjectTitle(page)).toHaveText('Project 2')
  await expect(projectNameField(page)).toBeHidden()
})

test('a new project started while a name field still has focus opens its own name field', async ({ page }) => {
  await page.goto('/')
  await startRename(page)
  await pressWithoutFocus(page.getByRole('button', { name: '+ New project' }))
  const field = projectNameField(page)
  await expect(field).toHaveValue('Project 2')
  await expect(field).toBeFocused()
  await afterNextFrames(page)
  await expect(field).toBeFocused()
  await expect(page.getByRole('article', { name: 'Home', exact: true })).toBeVisible()
})

test("Enter in a new project's name field closes the phone's sheet", PHONE, async ({ page }, testInfo) => {
  await page.goto('/')
  const field = await startNewProject(page)
  await expectSheet(page, testInfo, 'open')
  await field.fill('Cabin')
  await field.press('Enter')
  await expectSheet(page, testInfo, 'closed')
  // The sheet hands focus back to the button that opened it.
  if (isPhone(testInfo)) await expect(page.getByRole('button', { name: /^Projects · \d+$/ })).toBeFocused()
  await showProjects(page)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Cabin')
})

test("leaving a new project's name field keeps the sheet open", PHONE, async ({ page }, testInfo) => {
  await page.goto('/')
  const field = await startNewProject(page)
  await field.fill('Cabin')
  await field.blur()
  await expect(field).toBeHidden()
  await expectSheet(page, testInfo, 'open')
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Cabin')
})

test("Escape in a new project's name field keeps the sheet open, and so does renaming it afterwards", PHONE, async ({ page }, testInfo) => {
  await page.goto('/')
  await addProject(page)
  await expectSheet(page, testInfo, 'open')
  await expect(openProjectTitle(page)).toHaveText('Project 2')
  // The project is no longer new: Enter now only closes the field.
  const field = await startRename(page)
  await field.fill('Cabin')
  await field.press('Enter')
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Cabin')
  await expectSheet(page, testInfo, 'open')
})

test('renaming an existing project with Enter keeps the sheet open', PHONE, async ({ page }, testInfo) => {
  await page.goto('/')
  const field = await startRename(page)
  await field.fill('Casa')
  await field.press('Enter')
  const title = openProjectTitle(page)
  await expect(title).toHaveText('Casa')
  await expect(title).toBeFocused()
  await expectSheet(page, testInfo, 'open')
})

test("a card's controls scroll under the sheet's header, never over its Close button", PHONE, async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'only the phone shows the cards in a sheet')
  await page.goto('/')
  await addProject(page)
  await addProject(page)
  await expect(page.getByRole('article')).toHaveCount(3)
  const sheet = page.getByRole('dialog')
  const close = sheet.getByRole('button', { name: 'Close' })
  const more = openProjectMore(page)
  const closeBox = await close.boundingBox()
  const moreBox = await more.boundingBox()
  if (!closeBox || !moreBox) throw new Error('the sheet header or the open card is not on screen')
  // Scroll the sheet until the ··· button's centre sits level with the Close button's.
  const lift = moreBox.y + moreBox.height / 2 - (closeBox.y + closeBox.height / 2)
  await more.evaluate((el, dy) => {
    const scrolls = (node: Element) => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight
    let scroller = el.parentElement
    while (scroller && !scrolls(scroller)) scroller = scroller.parentElement
    if (!scroller) throw new Error('the sheet does not scroll')
    scroller.scrollBy(0, dy)
  }, lift)
  const isOverlapping = async () => {
    const [a, b] = [await close.boundingBox(), await more.boundingBox()]
    return !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  }
  await expect.poll(isOverlapping).toBe(true)
  const isCloseOnTop = () => close.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })
  expect(await isCloseOnTop()).toBe(true)
  await close.click()
  await expect(sheet).toBeHidden()
})

test("another project's card still shows its focus ring around the whole card", PHONE, async ({ page }) => {
  await page.goto('/')
  await addProject(page)
  const name = page.getByRole('button', { name: 'Home', exact: true })
  // Out and back in with the keyboard, so the browser treats the focus as keyboard focus and draws the ring.
  await name.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(name).toBeFocused()
  const ring = await name.evaluate((el, within) => {
    const card = el.closest('article')
    if (!card) throw new Error('the name button is not on a card')
    const layer = getComputedStyle(el, '::after')
    return {
      outline: `${layer.outlineStyle} ${layer.outlineWidth}`,
      isAsWideAsCard: Math.abs(parseFloat(layer.width) - card.clientWidth) < within,
      isAsTallAsCard: Math.abs(parseFloat(layer.height) - card.clientHeight) < within,
    }
  }, SAME_SIZE_WITHIN_PX)
  expect(ring).toEqual({ outline: 'solid 2px', isAsWideAsCard: true, isAsTallAsCard: true })
})

test('a card keeps its accessible name while its name is being edited', async ({ page }) => {
  await page.goto('/')
  await startRename(page)
  await expect(page.getByRole('article', { name: 'Home', exact: true })).toBeVisible()
  await page.keyboard.type('Casa')
  await expect(page.getByRole('article', { name: 'Casa', exact: true })).toBeVisible()
})

/**
 * Where the open card's name field ends and the line under it starts, read together: the phone's sheet may still be
 * sliding in, and two separate reads would catch it at two heights.
 */
const renameEdges = (page: Page) =>
  openProjectCard(page).evaluate((card) => {
    const field = card.querySelector('input')
    const meta = card.querySelector('.pcard__meta')
    if (!field || !meta) throw new Error('the open card has no name field, or no line under it')
    const style = getComputedStyle(field)
    const fieldBottom = field.getBoundingClientRect().bottom
    return {
      fieldBottom,
      // The focus ring is drawn outside the field's box, and the field has focus for as long as it is open.
      ringBottom: fieldBottom + parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
      metaTop: meta.getBoundingClientRect().top,
    }
  })

test('while a project is renamed, the name field and its focus ring stay above the line under it', PHONE, async ({ page }) => {
  await page.goto('/')
  const field = await startRename(page)
  await expect(field).toBeFocused()
  await fontsReady(page)
  const { fieldBottom, ringBottom, metaTop } = await renameEdges(page)
  expect(fieldBottom, 'the bottom of the name field against the top of the line under it').toBeLessThanOrEqual(metaTop)
  expect(ringBottom, "the bottom of the field's focus ring against the top of the line under it").toBeLessThanOrEqual(metaTop)
})

test('with a single project the ··· menu offers Rename and Duplicate, and no Delete', async ({ page }) => {
  await page.goto('/')
  const menu = await openProjectMenu(page)
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Duplicate'])
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
})
