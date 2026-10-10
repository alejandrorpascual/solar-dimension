import { expect, type Locator, type Page } from '@playwright/test'

/** How long one try of a first interaction waits before trying again: a click that lands before the page hydrates does nothing. */
const RETRY_AFTER_MS = 1000

/** Shows the project cards: always there in the desktop rail, behind the "Projects · N" button on narrower screens. */
export async function showProjects(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: /^Projects · \d+$/ })
  await expect(async () => {
    // Already open: the button behind the sheet is still visible but the sheet covers it.
    if (!(await page.getByRole('dialog').isVisible()) && (await open.isVisible())) await open.click()
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: RETRY_AFTER_MS })
  }).toPass()
}

/** Shows the Download tab: the rail's tab on desktop, the footer's Download button on step 3 elsewhere. */
export async function showDownload(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: 'Download', exact: true })
  if (await open.isVisible()) await open.click()
  await page.getByRole('tab', { name: 'Download' }).click()
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

/** Adds a project from the cards and returns its name field: the new project opens on top, already renaming. */
export async function startNewProject(page: Page): Promise<Locator> {
  await showProjects(page)
  const field = projectNameField(page)
  await clickUntilShown(page.getByRole('button', { name: '+ New project' }), field)
  return field
}

/** Starts renaming the open project from its card's title and returns the name field. */
export async function startRename(page: Page): Promise<Locator> {
  await showProjects(page)
  const field = projectNameField(page)
  await clickUntilShown(openProjectTitle(page), field)
  return field
}

/**
 * Renames the open project from its card's title, the way a person would. Enter on a project that was just created
 * also closes the phone's sheet, so call showProjects again before reading its card.
 */
export async function renameOpenProject(page: Page, name: string): Promise<void> {
  const field = await startRename(page)
  await field.fill(name)
  await field.press('Enter')
}
