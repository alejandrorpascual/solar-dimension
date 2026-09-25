import type { Page } from '@playwright/test'

/** Shows the project cards: always there in the desktop rail, behind the "Projects · N" button on narrower screens. */
export async function showProjects(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: /^Projects · \d+$/ })
  if (await open.isVisible()) await open.click()
  await page.getByRole('article').first().waitFor()
}

/** Closes the projects sheet if one is open, so the page underneath can be used. */
export async function hideProjects(page: Page): Promise<void> {
  if (await page.getByRole('dialog').isVisible()) await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}
