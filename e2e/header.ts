import { expect, type Page } from '@playwright/test'

/** Picks a language from the header's globe menu; its trigger is named in the current language ("Language: …" or "Idioma: …"). */
export async function switchLanguage(page: Page, language: 'English' | 'Español'): Promise<void> {
  await page.getByRole('button', { name: /^(Language|Idioma): / }).click()
  await page.getByRole('menuitemradio', { name: language }).click()
}

/**
 * Picks a language as the first thing after a page load, and leaves the page ready to measure. A click that lands
 * before hydration opens no menu, and `switchLanguage` would then wait on items that never come, so this opens the menu
 * until they show. Afterwards it waits for the menu to go: while it fades out it still has a box, and on a viewport
 * narrowed under it that box is what scrolls the page sideways.
 */
export async function switchLanguageOnLoad(page: Page, language: 'English' | 'Español'): Promise<void> {
  const choice = page.getByRole('menuitemradio', { name: language })
  await expect(async () => {
    if (!(await choice.isVisible())) await page.getByRole('button', { name: /^(Language|Idioma): / }).click()
    await expect(choice).toBeVisible({ timeout: 1000 })
  }).toPass()
  await choice.click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** Runs an item from the header's account menu, like "Sign out" or "Connect Google". */
export async function accountAction(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: /^Signed in as / }).click()
  await page.getByRole('menuitem', { name: item }).click()
}
