import { expect, type Locator, type Page } from '@playwright/test'

/** How long one try of a first interaction waits before trying again: a click that lands before the page hydrates does nothing. */
export const RETRY_AFTER_MS = 1000

/** Shows the project cards: always there in the desktop rail, behind the "Projects · N" button on narrower screens. */
export async function showProjects(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: /^Projects · \d+$/ })
  await expect(async () => {
    // Already open: the button behind the sheet is still visible but the sheet covers it.
    if (!(await page.getByRole('dialog').isVisible()) && (await open.isVisible())) await open.click()
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
}

/**
 * Shows the Download tab: the rail's tab on desktop, the footer's Download button on step 3 elsewhere. `label` is the
 * tab's name in the page's language.
 */
export async function showDownload(page: Page, label = 'Download'): Promise<void> {
  const open = page.getByRole('button', { name: label, exact: true })
  if (await open.isVisible()) await open.click()
  await page.getByRole('tab', { name: label }).click()
}

/** Opens a closed disclosure and leaves an open one alone. */
async function openDetails(box: Locator): Promise<void> {
  if ((await box.getAttribute('open')) === null) await box.locator('summary').click()
}

/** Step 2's voltage, chemistry and motors: the first box under the hours, closed until asked for. */
export const openBatterySettings = (page: Page) => openDetails(page.locator('.window > details').first())

/** The Download tab's Include boxes, closed until asked for. Over the rail and the sheet, the one that shows. */
export const openInclude = (page: Page) => openDetails(page.locator('.dl__include').filter({ visible: true }))

/** The kit's checks fold to one line while they all pass; a list with one that needs attention is already out. */
export async function openChecks(page: Page, name = 'Checks'): Promise<void> {
  const fold = page.getByRole('region', { name }).locator('details')
  if ((await fold.count()) > 0) await openDetails(fold)
}

/** Filters step 1's appliances: the chips from 1024 px, the select under it. Retried: a change before hydration does nothing. */
export async function pickCategory(page: Page, name: string): Promise<void> {
  const select = page.getByLabel('Category', { exact: true })
  if (!(await select.isVisible())) return page.getByRole('button', { name, exact: true }).click()
  await expect(async () => {
    await select.selectOption({ label: name })
    await expect(page.locator('.catalog__title')).toHaveCount(0, { timeout: RETRY_AFTER_MS }) // One category needs no section titles.
  }).toPass()
}

/** Closes the projects sheet if one is open, so the page underneath can be used. */
export async function hideProjects(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  // A new project opens renaming; that field takes the first Escape and the next one closes the sheet.
  for (let i = 0; i < 2 && (await dialog.isVisible()); i++) await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
}

/** The open project's card: pinned first in the rail. */
export const openProjectCard = (page: Page) => page.getByRole('article').first()

/** The open project's name on its card: the button that starts a rename. */
export const openProjectTitle = (page: Page) => openProjectCard(page).getByRole('heading').getByRole('button')

/** The open project's ··· button. */
export const openProjectMore = (page: Page) => openProjectCard(page).getByRole('button', { name: /^More actions for / })

/** The field a project's name is edited in, on its card. */
export const projectNameField = (page: Page) => page.getByLabel('Project name')

/** Clicks `trigger` until `shown` appears, and never while it is already showing, so it is safe right after a load. */
async function clickUntilShown(trigger: Locator, shown: Locator): Promise<void> {
  await expect(async () => {
    if (!(await shown.isVisible())) await trigger.click()
    await expect(shown).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
}

/** Opens the open project's ··· menu and returns it. */
export async function openProjectMenu(page: Page): Promise<Locator> {
  await showProjects(page)
  const menu = page.getByRole('menu')
  await clickUntilShown(openProjectMore(page), menu)
  return menu
}

/** Picks an action from the open project's ··· menu. */
export async function openProjectAction(page: Page, action: 'Rename' | 'Duplicate' | 'Delete'): Promise<void> {
  const menu = await openProjectMenu(page)
  await menu.getByRole('menuitem', { name: action }).click()
}

/** What the open project's card asks, in place, after Delete is chosen from its ··· menu. */
export const deleteAsk = (page: Page) => openProjectCard(page).getByRole('alert')

/** Answers that question on the open project's card: `Delete project` deletes it, `Cancel` keeps it. */
export const answerDelete = (page: Page, answer: 'Delete project' | 'Cancel') =>
  openProjectCard(page).getByRole('button', { name: answer, exact: true }).click()

/** Adds a project from the cards and returns its name field: the new project opens on top, already renaming. Call it with no name field open. */
export async function startNewProject(page: Page): Promise<Locator> {
  await showProjects(page)
  const field = projectNameField(page)
  await clickUntilShown(page.getByRole('button', { name: '+ New project' }), field)
  return field
}

/**
 * Presses Enter in the name field of a project that was just created, then brings the cards back. That Enter closes
 * the phone's sheet, and the sheet has to be gone before it can be opened again: while it animates out it still
 * counts as open.
 */
export async function acceptNewProjectName(page: Page): Promise<void> {
  await projectNameField(page).press('Enter')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await showProjects(page)
}

/** Starts renaming the open project from its card's title and returns the name field. */
export async function startRename(page: Page): Promise<Locator> {
  await showProjects(page)
  const field = projectNameField(page)
  await clickUntilShown(openProjectTitle(page), field)
  return field
}

/** Renames the open project from its card's title, the way a person would. For a project that was just created, see acceptNewProjectName. */
export async function renameOpenProject(page: Page, name: string): Promise<void> {
  const field = await startRename(page)
  await field.fill(name)
  await field.press('Enter')
}
