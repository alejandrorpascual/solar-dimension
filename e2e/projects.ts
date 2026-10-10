import type { Page } from '@playwright/test'

/** Shows the project cards: always there in the desktop rail, behind the "Projects · N" button on narrower screens. */
export async function showProjects(page: Page): Promise<void> {
  // Already open: the button behind the sheet is still visible but the sheet covers it.
  if (await page.getByRole('dialog').isVisible()) return
  const open = page.getByRole('button', { name: /^Projects · \d+$/ })
  if (await open.isVisible()) await open.click()
  await page.getByRole('article').first().waitFor()
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

/** Picks an action from the open project's ··· menu. */
export async function openProjectAction(page: Page, action: 'Rename' | 'Duplicate' | 'Delete'): Promise<void> {
  await showProjects(page)
  await openProjectCard(page).getByRole('button', { name: /^More actions for / }).click()
  await page.getByRole('menuitem', { name: action }).click()
}

/** The open project's card: pinned first in the rail. */
export const openProjectCard = (page: Page) => page.getByRole('article').first()

/** Renames the open project from its card's title, the way a person would. */
export async function renameOpenProject(page: Page, name: string): Promise<void> {
  await showProjects(page)
  const field = page.getByLabel('Project name')
  if (!(await field.isVisible())) await openProjectCard(page).getByRole('heading').getByRole('button').click()
  await field.fill(name)
  await field.press('Enter')
}
